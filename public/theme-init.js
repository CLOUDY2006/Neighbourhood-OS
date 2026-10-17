try {
  var a = JSON.parse(localStorage.getItem("nos-a11y") || "{}");
  var t = a.theme === "light" || a.theme === "dark" ? a.theme : matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  document.documentElement.dataset.theme = t;
} catch (e) {}