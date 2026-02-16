// content.js — QCM solver with Vue.js/Inertia.js + React support + human simulation

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

    // SPA navigation detection (Inertia.js, Vue Router, React Router)
    window.addEventListener("popstate", () => {
      if (!config.enabled) return;
      lastContentHash = "";
      solvedQuestions.clear();
      setTimeout(() => scanAndSolve(), 1500);
    });
    window.addEventListener("hashchange", () => {
      if (!config.enabled) return;
      lastContentHash = "";
      solvedQuestions.clear();
      setTimeout(() => scanAndSolve(), 1500);
    });

    // Intercept Inertia.js page visits (fires on "suivant", "changer", etc.)
    document.addEventListener("inertia:navigate", () => {
      if (!config.enabled) return;
      lastContentHash = "";
      solvedQuestions.clear();
      setTimeout(() => scanAndSolve(), 1500);
    });

    // Click listener for navigation buttons (suivant, changer, next, etc.)
    document.addEventListener("click", (e) => {
      if (!config.enabled) return;
      const btn = e.target.closest("a, button, [role='button'], [class*='btn']");
      if (!btn) return;
      const txt = btn.textContent.toLowerCase().trim();
      const navKeywords = ["suivant", "next", "changer", "change", "continuer",
        "continue", "précédent", "previous", "valider", "submit", "passer"];
      if (navKeywords.some((kw) => txt.includes(kw))) {
        // Navigation button clicked — force re-scan after a delay
        lastContentHash = "";
        solvedQuestions.clear();
        setTimeout(() => scanAndSolve(), 2000);
      }
    }, true);

    showBadge("ON", "#4ade80");
  }

  // ---------- Main scan & solve ----------
  async function scanAndSolve() {
    if (!config.enabled || processing) return;
    if (!config.apiKey) return;

    const currentHash = hashContent();
    if (currentHash === lastContentHash) return;

    // Content changed — clear old solved questions (page reloaded/new quiz)
    if (lastContentHash !== "") {
      solvedQuestions.clear();
    }
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

    // Strategy 3: Clickable divs/buttons (Vue/React apps)
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
        "[role='listbox']",
        // DaisyUI / Tailwind patterns
        ".form-control",
        ".card",
        "[class*='FormControl']",
        // React patterns
        "[class*='MuiRadioGroup']",
        "[class*='RadioGroup']",
      ].join(", ")
    );

    questionBlocks.forEach((block) => {
      if (block.querySelector('input[type="radio"], input[type="checkbox"]'))
        return;

      const options = block.querySelectorAll(
        [
          "[role='option']",
          "[role='radio']",
          "[class*='option']",
          "[class*='answer']",
          "[class*='choice']",
          "button[class*='option']",
          "li[class*='option']",
          // DaisyUI / Tailwind button patterns
          ".btn-group > button",
          ".join > button",
          ".menu > li",
          "button.btn",
          ".btn.btn-outline",
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
        "form, .question, .quiz-question, [class*='question'], fieldset, .card, .panel, .form-group, .form-control, div"
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
  //  MAIN WORLD BRIDGE — sends commands to inject.js via postMessage
  //  This is critical: Vue/React state changes MUST happen in MAIN world
  // =================================================================

  // Tag element with a unique attribute so inject.js can find it
  function tagElement(el) {
    const uid = "q" + Math.random().toString(36).slice(2, 10);
    el.setAttribute("data-qid", uid);
    return `[data-qid="${uid}"]`;
  }

  // Tell inject.js (MAIN world) to check a radio/checkbox
  function triggerCheckInMainWorld(inputEl) {
    const selector = tagElement(inputEl);
    window.postMessage({ __qcm: true, action: "check", selector }, "*");
  }

  // Tell inject.js (MAIN world) to click a button/div
  function triggerClickInMainWorld(el) {
    const selector = tagElement(el);
    window.postMessage({ __qcm: true, action: "click", clickSelector: selector }, "*");
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

  function findOptionContainer(el) {
    return (
      el.closest(
        ".option, [class*='option'], [class*='choice'], [class*='answer'], [role='option'], [role='radio'], .label, .form-control, .btn"
      ) || el.parentElement
    );
  }

  async function simulateMousePath(target) {
    const end = getCenter(target);
    const steps = rand(8, 16);
    let startX = end.x + rand(-250, 250);
    let startY = end.y + rand(-120, 120);

    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
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
    el.dispatchEvent(
      new MouseEvent("mouseenter", { ...props, bubbles: false })
    );
    el.dispatchEvent(new MouseEvent("mouseover", { ...props, bubbles: true }));
  }

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

  // Full human interaction for input elements (radio/checkbox)
  async function humanInteract(inputEl) {
    const container = findOptionContainer(inputEl);

    // 1. Mouse path to the option
    await simulateMousePath(container);
    await sleep(rand(50, 150));

    // 2. Hover the container
    simulateHover(container);
    await sleep(rand(60, 180));

    // 3. Hover inner label
    const label =
      document.querySelector(`label[for="${inputEl.id}"]`) ||
      inputEl.closest("label");
    if (label && label !== container) {
      simulateHover(label);
      await sleep(rand(40, 100));
    }

    // 4. Click the container/label (visual click)
    const clickTarget = label || container;
    simulateClick(clickTarget);
    await sleep(rand(50, 120));

    // 5. ALWAYS force state change via MAIN world bridge
    //    Vue's v-model won't react to ISOLATED world events
    triggerCheckInMainWorld(inputEl);
  }

  // Full human interaction for clickable divs/buttons
  async function humanClickElement(el) {
    const container = findOptionContainer(el);

    await simulateMousePath(container);
    await sleep(rand(50, 150));
    simulateHover(container);
    await sleep(rand(80, 200));
    simulateClick(el);

    // Trigger click in MAIN world where Vue/React live
    triggerClickInMainWorld(el);
  }

  // Re-query a fresh element from the DOM after Vue re-renders
  // Vue's reactivity can replace DOM nodes after state changes
  function refetchElement(question, optIndex) {
    if (question.type === "radio") {
      // Re-query radio by name + value
      const name = question.elements[0]?.name;
      if (name) {
        const radios = document.querySelectorAll(`input[type="radio"][name="${name}"]`);
        return radios[optIndex] || null;
      }
    } else if (question.type === "checkbox") {
      // Re-query checkboxes within the same container
      const container = question.elements[0]?.closest(
        ".card, .form-control, fieldset, form, [class*='question']"
      );
      if (container) {
        const checkboxes = container.querySelectorAll('input[type="checkbox"]');
        return checkboxes[optIndex] || null;
      }
    } else if (question.type === "click") {
      // Re-query buttons within the same container
      const container = question.elements[0]?.closest(
        ".card, .card-body, [class*='question']"
      );
      if (container) {
        const buttons = container.querySelectorAll(
          "button.btn, [role='option'], [class*='option'], [class*='choice']"
        );
        return buttons[optIndex] || null;
      }
    }
    return null;
  }

  // Apply all answers with human pacing
  async function applyAnswersHuman(questions, aiAnswers) {
    for (let a = 0; a < aiAnswers.length; a++) {
      const answer = aiAnswers[a];
      const qIndex = answer.question - 1;
      const question = questions[qIndex];
      if (!question) continue;

      // Reading delay
      await sleep(a === 0 ? rand(800, 2000) : rand(1500, 4500));

      const selectedIndices = answer.answers.map(
        (l) => l.toUpperCase().charCodeAt(0) - 65
      );

      for (let s = 0; s < selectedIndices.length; s++) {
        const optIndex = selectedIndices[s];

        // Always try to get a fresh DOM element (Vue may have re-rendered)
        let el = question.options[optIndex]?.element;
        if (!el || !el.isConnected) {
          el = refetchElement(question, optIndex);
        }
        if (!el) continue;

        if (question.type === "radio" || question.type === "checkbox") {
          await humanInteract(el);
        } else if (question.type === "click") {
          await humanClickElement(el);
        }

        // Wait for Vue to re-render before next selection
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
