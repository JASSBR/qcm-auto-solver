// content.js — Détecte les QCM et les résout avec simulation humaine réaliste

(() => {
  let config = { enabled: false, provider: "anthropic", apiKey: "", model: "" };
  let processing = false;
  let lastContentHash = "";
  let solvedQuestions = new Set();
  let debounceTimer = null;

  // ---------- Init ----------
  loadConfig().then(() => {
    if (config.enabled) {
      startObserver();
      setTimeout(() => scanAndSolve(), 1500);
    }
  });

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === "CONFIG_UPDATED") {
      loadConfig().then(() => {
        if (config.enabled) {
          startObserver();
          scanAndSolve();
        } else {
          showBadge("OFF", "#f87171");
        }
      });
    }
  });

  async function loadConfig() {
    const data = await chrome.storage.local.get([
      "enabled",
      "provider",
      "apiKey",
      "model",
    ]);
    config = { ...config, ...data };
  }

  // ---------- MutationObserver ----------
  let observer = null;

  function startObserver() {
    if (observer) observer.disconnect();
    observer = new MutationObserver(() => {
      if (!config.enabled) return;
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => scanAndSolve(), 2000);
    });
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
    });
    showBadge("ON", "#4ade80");
  }

  // ---------- Main scan & solve ----------
  async function scanAndSolve() {
    if (!config.enabled || processing) return;
    if (!config.apiKey) return;

    const currentHash = hashContent();
    if (currentHash === lastContentHash) return;
    lastContentHash = currentHash;

    const questions = detectQuestions();
    if (questions.length === 0) return;

    const newQuestions = questions.filter(
      (q) => !solvedQuestions.has(q.signature)
    );
    if (newQuestions.length === 0) return;

    processing = true;
    showBadge("...", "#fbbf24");

    try {
      const response = await chrome.runtime.sendMessage({
        type: "SOLVE_QCM",
        payload: {
          questions: newQuestions,
          provider: config.provider,
          apiKey: config.apiKey,
          model: config.model,
        },
      });

      if (response.success) {
        await applyAnswersHuman(newQuestions, response.data);
        newQuestions.forEach((q) => solvedQuestions.add(q.signature));
        showBadge("OK", "#4ade80");
      } else {
        showBadge("ERR", "#f87171");
      }
    } catch (err) {
      showBadge("ERR", "#f87171");
    } finally {
      processing = false;
    }
  }

  // ---------- Question detection ----------
  function detectQuestions() {
    const questions = [];

    // Strategy 1: Radio button groups
    const radioGroups = {};
    document.querySelectorAll('input[type="radio"]').forEach((radio) => {
      const name = radio.name;
      if (!name) return;
      if (!radioGroups[name]) radioGroups[name] = [];
      radioGroups[name].push(radio);
    });

    for (const [name, radios] of Object.entries(radioGroups)) {
      if (radios.length < 2) continue;
      const q = extractQuestionFromInputs(radios, "radio");
      if (q) questions.push(q);
    }

    // Strategy 2: Checkbox groups
    const checkboxContainers = new Set();
    document.querySelectorAll('input[type="checkbox"]').forEach((cb) => {
      const container = cb.closest(
        "form, .question, .quiz-question, [class*='question'], [class*='quiz'], fieldset, .card, .panel"
      );
      if (container) checkboxContainers.add(container);
    });

    checkboxContainers.forEach((container) => {
      const checkboxes = [
        ...container.querySelectorAll('input[type="checkbox"]'),
      ];
      if (checkboxes.length < 2) return;
      const q = extractQuestionFromInputs(checkboxes, "checkbox");
      if (q) questions.push(q);
    });

    // Strategy 3: Clickable option divs/buttons
    const questionBlocks = document.querySelectorAll(
      [
        ".question",
        ".quiz-question",
        "[class*='question-container']",
        "[class*='quiz-item']",
        "[class*='qcm']",
        "[data-question]",
        "[role='radiogroup']",
        "[role='group']",
      ].join(", ")
    );

    questionBlocks.forEach((block) => {
      if (block.querySelector('input[type="radio"], input[type="checkbox"]'))
        return;

      const options = block.querySelectorAll(
        [
          "[role='option']",
          "[class*='option']",
          "[class*='answer']",
          "[class*='choice']",
          "button[class*='option']",
          "li[class*='option']",
        ].join(", ")
      );

      if (options.length < 2) return;

      const questionText = findQuestionText(block);
      if (!questionText) return;

      const opts = [...options].map((el, i) => ({
        text: el.textContent.trim(),
        element: el,
        index: i,
      }));

      questions.push({
        questionText,
        options: opts,
        type: "click",
        elements: [...options],
        signature: hashString(questionText + opts.map((o) => o.text).join("|")),
      });
    });

    return questions;
  }

  function extractQuestionFromInputs(inputs, type) {
    const container =
      inputs[0].closest(
        "form, .question, .quiz-question, [class*='question'], fieldset, .card, .panel, .form-group, div"
      ) || inputs[0].parentElement?.parentElement;

    if (!container) return null;

    const questionText = findQuestionText(container);
    const options = inputs.map((input, i) => {
      const label =
        document.querySelector(`label[for="${input.id}"]`) ||
        input.closest("label") ||
        input.parentElement;

      return {
        text: label ? label.textContent.trim() : `Option ${i + 1}`,
        element: input,
        index: i,
      };
    });

    if (!questionText && options.every((o) => o.text.startsWith("Option ")))
      return null;

    return {
      questionText: questionText || "(Question sans texte détecté)",
      options,
      type,
      elements: inputs,
      signature: hashString(
        (questionText || "") + options.map((o) => o.text).join("|")
      ),
    };
  }

  function findQuestionText(container) {
    const selectors = [
      "h1, h2, h3, h4, h5, h6",
      ".question-text",
      "[class*='question-title']",
      "[class*='question-body']",
      "[class*='prompt']",
      "legend",
      "p",
      "label.question",
      ".title",
    ];

    for (const sel of selectors) {
      const el = container.querySelector(sel);
      if (el) {
        const text = el.textContent.trim();
        if (text.length > 5 && text.length < 2000) return text;
      }
    }

    const walker = document.createTreeWalker(
      container,
      NodeFilter.SHOW_TEXT,
      null
    );
    let node;
    while ((node = walker.nextNode())) {
      const text = node.textContent.trim();
      if (text.length > 10 && text.length < 2000) return text;
    }

    return null;
  }

  // =================================================================
  //  HUMAN-LIKE SIMULATION
  // =================================================================

  function rand(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  function getCenter(el) {
    const rect = el.getBoundingClientRect();
    return {
      x: rect.left + rect.width / 2 + rand(-3, 3),
      y: rect.top + rect.height / 2 + rand(-2, 2),
      screenX: window.screenX + rect.left + rect.width / 2,
      screenY: window.screenY + rect.top + rect.height / 2,
    };
  }

  // Find the outermost interactive container (.option, [role=option], etc.)
  function findOptionContainer(el) {
    return (
      el.closest(
        ".option, [class*='option'], [class*='choice'], [class*='answer'], [role='option']"
      ) || el.parentElement
    );
  }

  // Simulate smooth mouse path to an element
  async function simulateMousePath(target) {
    const end = getCenter(target);
    const steps = rand(8, 16);
    let startX = end.x + rand(-250, 250);
    let startY = end.y + rand(-120, 120);

    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      // Bezier-like ease-in-out
      const ease = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
      const x = startX + (end.x - startX) * ease + rand(-2, 2);
      const y = startY + (end.y - startY) * ease + rand(-1, 1);

      document.dispatchEvent(
        new MouseEvent("mousemove", {
          bubbles: true,
          cancelable: true,
          clientX: x,
          clientY: y,
          screenX: window.screenX + x,
          screenY: window.screenY + y,
          view: window,
        })
      );
      await sleep(rand(12, 40));
    }

    // Final mousemove directly on the target element
    target.dispatchEvent(
      new MouseEvent("mousemove", {
        bubbles: true,
        cancelable: true,
        clientX: end.x,
        clientY: end.y,
        screenX: end.screenX,
        screenY: end.screenY,
        view: window,
      })
    );
  }

  // Dispatch hover events on a specific element
  function simulateHover(el) {
    const pos = getCenter(el);
    const props = {
      cancelable: true,
      clientX: pos.x,
      clientY: pos.y,
      screenX: pos.screenX,
      screenY: pos.screenY,
      view: window,
    };

    // mouseenter does NOT bubble — must dispatch directly on the target
    el.dispatchEvent(new MouseEvent("mouseenter", { ...props, bubbles: false }));
    el.dispatchEvent(new MouseEvent("mouseover", { ...props, bubbles: true }));
  }

  // Full click chain: mousedown → pause → mouseup → click
  function simulateClick(el) {
    const pos = getCenter(el);
    const props = {
      bubbles: true,
      cancelable: true,
      clientX: pos.x,
      clientY: pos.y,
      screenX: pos.screenX,
      screenY: pos.screenY,
      button: 0,
      buttons: 1,
      detail: 1,
      view: window,
    };

    el.dispatchEvent(new MouseEvent("mousedown", props));
    el.dispatchEvent(new MouseEvent("mouseup", { ...props, buttons: 0 }));
    el.dispatchEvent(new MouseEvent("click", { ...props, buttons: 0 }));
  }

  // Complete human interaction: move → hover container → hover target → click
  async function humanInteract(inputEl) {
    // Find the visual container (.option div) that likely has hover handlers
    const container = findOptionContainer(inputEl);

    // 1. Move mouse toward the container
    await simulateMousePath(container);
    await sleep(rand(50, 150));

    // 2. Hover the container (triggers onmouseenter on .option divs)
    simulateHover(container);
    await sleep(rand(60, 180));

    // 3. Also hover the inner label/input area
    const label =
      document.querySelector(`label[for="${inputEl.id}"]`) ||
      inputEl.closest("label");
    if (label && label !== container) {
      simulateHover(label);
      await sleep(rand(40, 100));
    }

    // 4. Click the label (this toggles the radio/checkbox via browser activation behavior)
    const clickTarget = label || inputEl;
    simulateClick(clickTarget);
    await sleep(rand(20, 60));

    // 5. If the input still isn't checked (some browsers skip activation for
    //    dispatched events), force it — but do NOT dispatch duplicate change events
    if (!inputEl.checked) {
      inputEl.checked = true;
      inputEl.dispatchEvent(new Event("change", { bubbles: true }));
    }
  }

  // Apply all answers with human-like pacing
  async function applyAnswersHuman(questions, aiAnswers) {
    for (let a = 0; a < aiAnswers.length; a++) {
      const answer = aiAnswers[a];
      const qIndex = answer.question - 1;
      const question = questions[qIndex];
      if (!question) continue;

      // Reading delay between questions
      await sleep(a === 0 ? rand(800, 2000) : rand(1500, 4500));

      const selectedIndices = answer.answers.map(
        (l) => l.toUpperCase().charCodeAt(0) - 65
      );

      for (let s = 0; s < selectedIndices.length; s++) {
        const optIndex = selectedIndices[s];
        const option = question.options[optIndex];
        if (!option) continue;

        if (question.type === "radio" || question.type === "checkbox") {
          await humanInteract(option.element);
        } else if (question.type === "click") {
          const container = findOptionContainer(option.element);
          await simulateMousePath(container);
          await sleep(rand(50, 150));
          simulateHover(container);
          await sleep(rand(80, 200));
          simulateClick(option.element);
        }

        // Delay between multiple selections (checkboxes)
        if (selectedIndices.length > 1 && s < selectedIndices.length - 1) {
          await sleep(rand(400, 1000));
        }
      }
    }
  }

  // ---------- Utilities ----------
  function hashContent() {
    return hashString(document.body.innerText.substring(0, 5000));
  }

  function hashString(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = (hash << 5) - hash + str.charCodeAt(i);
      hash |= 0;
    }
    return hash.toString();
  }

  // Discreet badge — no identifiable ID, low z-index
  let badgeEl = null;
  function showBadge(text, color) {
    if (!badgeEl) {
      badgeEl = document.createElement("div");
      document.body.appendChild(badgeEl);
    }
    badgeEl.textContent = text;
    badgeEl.style.cssText = `
      position: fixed;
      bottom: 12px;
      right: 12px;
      background: ${color}33;
      color: ${color};
      border: 1px solid ${color}66;
      padding: 4px 10px;
      border-radius: 12px;
      font-size: 11px;
      font-weight: 600;
      font-family: -apple-system, sans-serif;
      z-index: 9999;
      pointer-events: none;
      opacity: 0.7;
    `;
  }
})();
