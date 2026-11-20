import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

const widths = [320, 390, 768, 1440];

test("home page loads without errors and with the expected head", async ({ page }) => {
  const problems: string[] = [];
  page.on("console", (m) => m.type() === "error" && problems.push(m.text()));
  page.on("pageerror", (e) => problems.push(e.message));
  page.on("requestfailed", (r) => problems.push(`failed: ${r.url()}`));
  page.on("response", (r) => r.status() >= 400 && problems.push(`${r.status()}: ${r.url()}`));

  const response = await page.goto("/");
  expect(response?.status()).toBe(200);
  await expect(page.locator("h1")).toHaveText("AV2. Encode it. Decode it. Trust it.");
  await expect(page.locator(".wordmark")).toHaveText("splot");
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
    "href",
    "https://splotlabs.io/",
  );
  await expect(page.locator('meta[name="robots"]')).toHaveCount(0);
  await expect(page.locator('meta[property="og:image"]')).toHaveAttribute(
    "content",
    "https://splotlabs.io/og.png",
  );
  expect(problems).toEqual([]);
});

test("security headers come from _headers", async ({ request }) => {
  const headers = (await request.get("/")).headers();
  expect(headers["content-security-policy"]).toContain("default-src 'none'");
  expect(headers["x-content-type-options"]).toBe("nosniff");
  expect(headers["x-frame-options"]).toBe("DENY");
  expect(headers["referrer-policy"]).toBe("strict-origin-when-cross-origin");
  // The production host must stay indexable.
  expect(headers["x-robots-tag"]).toBeUndefined();
});

test("a missing path returns a real 404 page", async ({ page }) => {
  const response = await page.goto("/no-such-page");
  expect(response?.status()).toBe(404);
  await expect(page.locator("h1")).toHaveText("This page does not exist.");
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", "noindex");
});

test("static files are served", async ({ request }) => {
  for (const path of ["/favicon.svg", "/og.png", "/robots.txt", "/sitemap.xml"]) {
    expect((await request.get(path)).status(), path).toBe(200);
  }
  expect((await request.get("/_headers")).status()).toBe(404);
});

for (const width of widths) {
  test(`no horizontal overflow at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/");
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBe(0);
  });
}

test("every internal anchor has a target", async ({ page }) => {
  await page.goto("/");
  const missing = await page.evaluate(() =>
    [...document.querySelectorAll<HTMLAnchorElement>('a[href*="#"]')]
      .filter((a) => a.origin === location.origin && a.hash.length > 1)
      .filter((a) => !document.getElementById(a.hash.slice(1)))
      .map((a) => a.getAttribute("href")),
  );
  expect(missing).toEqual([]);
});

test("a copy button copies the command and gives feedback", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/");
  const button = page.getByRole("button", { name: "Copy the validate command", exact: true });
  await button.click();
  await expect(button).toHaveText("Copied");
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("splot validate clip.ivf");
  await expect(button).toHaveText("Copy");
});

test("the compact menu opens, navigates and closes", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(page.locator(".bar-links")).toBeHidden();
  await page.locator(".menu summary").click();
  await page.locator(".menu").getByRole("link", { name: "Install" }).click();
  await expect(page).toHaveURL(/#install$/);
  await expect(page.locator(".menu")).not.toHaveAttribute("open", "");
  await expect(page.locator("#install")).toBeInViewport();
});

test("keyboard: the skip link is the first stop and is visible", async ({ page }) => {
  await page.goto("/");
  await page.keyboard.press("Tab");
  const skip = page.locator(".skip");
  await expect(skip).toBeFocused();
  await expect(skip).toBeInViewport();
});

test("reduced motion stops the background drift", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  const name = await page
    .locator(".glow i")
    .first()
    .evaluate((el) => getComputedStyle(el).animationName);
  expect(name).toBe("none");
});

test("the page is usable without JavaScript", async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  await page.goto("/");
  await expect(page.locator("h1")).toBeVisible();
  await expect(page.locator("#install code").first()).toBeVisible();
  await expect(page.getByRole("link", { name: "Install from source" })).toBeVisible();
  await expect(page.locator("button[data-copy]").first()).toBeHidden();
  await context.close();
});

for (const path of ["/", "/no-such-page"]) {
  for (const width of [390, 1440]) {
    test(`axe finds no violations on ${path} at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(path);
      const results = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"])
        .analyze();
      expect(results.violations.map((v) => `${v.id}: ${v.nodes.length}`)).toEqual([]);
    });
  }
}
