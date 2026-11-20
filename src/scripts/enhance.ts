// Copy buttons are an enhancement. Without JavaScript they stay hidden.
document.documentElement.classList.add("js");
const live = document.getElementById("copy-status");

document.addEventListener("click", async (event) => {
  const target = event.target as HTMLElement;
  const button = target.closest<HTMLButtonElement>("button[data-copy]");
  if (button) {
    const label = button.textContent;
    try {
      await navigator.clipboard.writeText(button.dataset.copy ?? "");
      button.textContent = "Copied";
      if (live) live.textContent = "Copied to the clipboard.";
    } catch {
      button.textContent = "Copy failed";
      if (live) live.textContent = "The copy failed. Select the text and copy it.";
    }
    setTimeout(() => {
      button.textContent = label;
      if (live) live.textContent = "";
    }, 1600);
  }
  // Close the compact menu after a link is selected.
  target.closest(".menu a")?.closest("details")?.removeAttribute("open");
});
