const $ = (id) => document.getElementById(id);

document.addEventListener("DOMContentLoaded", async () => {
  const data = await chrome.storage.local.get([
    "enabled",
    "provider",
    "apiKey",
    "model",
  ]);

  $("enabled").checked = data.enabled ?? false;
  $("provider").value = data.provider ?? "anthropic";
  $("apiKey").value = data.apiKey ?? "";
  $("model").value =
    data.model ??
    (data.provider === "openai" ? "gpt-4o" : "claude-sonnet-4-5-20250929");

  updateStatus(data.enabled);

  $("provider").addEventListener("change", () => {
    const p = $("provider").value;
    if (!$("model").value || $("model").value.startsWith("claude-") || $("model").value.startsWith("gpt-")) {
      $("model").value = p === "openai" ? "gpt-4o" : "claude-sonnet-4-5-20250929";
    }
  });

  $("save").addEventListener("click", async () => {
    const settings = {
      enabled: $("enabled").checked,
      provider: $("provider").value,
      apiKey: $("apiKey").value.trim(),
      model: $("model").value.trim(),
    };
    await chrome.storage.local.set(settings);
    updateStatus(settings.enabled);

    // Notify active tab to reload config
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.id) {
      chrome.tabs.sendMessage(tab.id, { type: "CONFIG_UPDATED" }).catch(() => {});
    }

    $("save").textContent = "Sauvegardé !";
    setTimeout(() => ($("save").textContent = "Sauvegarder"), 1500);
  });
});

function updateStatus(enabled) {
  const el = $("status");
  if (enabled) {
    el.textContent = "Actif — Surveillance en cours";
    el.className = "status active";
  } else {
    el.textContent = "Inactif";
    el.className = "status inactive";
  }
}
