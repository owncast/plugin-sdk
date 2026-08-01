const tabName = document.querySelector("#tab-name");
const title = document.querySelector("#title");
const description = document.querySelector("#description");
const footer = document.querySelector("#footer");
const requireAcceptance = document.querySelector("#require-acceptance");
const rules = document.querySelector("#rules");
const count = document.querySelector("#count");
const status = document.querySelector("#status");
const dirty = document.querySelector("#dirty");
const save = document.querySelector("#save");
const form = document.querySelector("#rules-form");
const template = document.querySelector("#rule-template");

// The editor state as last loaded or saved. Anything different from this is an
// unsaved edit, which the "Unsaved changes" badge surfaces.
let savedState = "";

function ruleValues() {
  return [...rules.querySelectorAll("textarea")].map((field) => field.value.trim());
}

function currentState() {
  return JSON.stringify({
    tabName: tabName.value.trim(),
    title: title.value.trim(),
    description: description.value.trim(),
    footer: footer.value.trim(),
    requireAcceptance: requireAcceptance.checked,
    rules: ruleValues(),
  });
}

function refresh() {
  const entries = [...rules.querySelectorAll(".rule")];
  entries.forEach((entry, index) => {
    entry.querySelector(".rule__number").textContent = String(index + 1).padStart(2, "0");
    entry.querySelector("textarea").setAttribute("aria-label", `Rule ${index + 1}`);
    entry.querySelector(".move-up").disabled = index === 0;
    entry.querySelector(".move-down").disabled = index === entries.length - 1;
  });
  count.textContent = `${entries.length} rule${entries.length === 1 ? "" : "s"}`;
  dirty.hidden = currentState() === savedState;
}

function addRule(value = "") {
  const entry = template.content.firstElementChild.cloneNode(true);
  entry.querySelector("textarea").value = value;
  entry.querySelector(".remove").onclick = () => {
    const next = entry.nextElementSibling || entry.previousElementSibling;
    entry.remove();
    refresh();
    next?.querySelector("textarea").focus();
  };
  entry.querySelector(".move-up").onclick = () => move(entry, -1);
  entry.querySelector(".move-down").onclick = () => move(entry, 1);
  rules.append(entry);
  refresh();
  return entry;
}

// Reordering keeps focus on the button the admin is clicking, so a rule can be
// walked up or down the list with repeated presses.
function move(entry, offset) {
  const sibling = offset < 0 ? entry.previousElementSibling : entry.nextElementSibling;
  if (!sibling) return;
  if (offset < 0) sibling.before(entry);
  else sibling.after(entry);
  refresh();
  entry.querySelector(offset < 0 ? ".move-up" : ".move-down").focus();
}

async function load() {
  try {
    const response = await fetch("./api/rules");
    if (!response.ok) throw new Error("Could not load rules.");
    const settings = await response.json();
    tabName.value = settings.tabName;
    title.value = settings.title;
    description.value = settings.description;
    footer.value = settings.footer;
    requireAcceptance.checked = settings.requireAcceptance;
    settings.rules.forEach(addRule);
    savedState = currentState();
    refresh();
  } catch (error) {
    status.textContent = error.message;
    status.className = "error";
  }
}

document.querySelector("#add").onclick = () => addRule().querySelector("textarea").focus();
form.oninput = refresh;
form.onsubmit = async (event) => {
  event.preventDefault();
  const values = ruleValues();
  if (values.some((value) => !value)) {
    status.textContent = "Each rule needs text, or remove it.";
    status.className = "error";
    return;
  }
  save.disabled = true;
  status.textContent = "Saving…";
  status.className = "muted";
  const pending = currentState();
  try {
    const payload = {
      tabName: tabName.value.trim(),
      title: title.value.trim(),
      description: description.value.trim(),
      footer: footer.value.trim(),
      requireAcceptance: requireAcceptance.checked,
      rules: values,
    };
    const response = await fetch("./api/rules", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!response.ok) throw new Error((await response.text()) || "Could not save rules.");
    savedState = pending;
    status.textContent = `Saved. Viewers can see the updated ${tabName.value.trim()} tab now.`;
    status.className = "muted";
  } catch (error) {
    status.textContent = error.message;
    status.className = "error";
  } finally {
    save.disabled = false;
    refresh();
  }
};
load();
