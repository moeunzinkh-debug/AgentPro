import { expect, test, type Locator, type Page } from '@playwright/test';

async function expectUsable(locator: Locator) {
  await expect(locator).toBeInViewport({ ratio: 1 });
  // A visible bounding box alone does not catch overlapping/clipping panels.
  expect(await locator.evaluate((element) => {
    const box = element.getBoundingClientRect();
    return element.contains(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2));
  })).toBe(true);
}

async function expectShellFits(page: Page) {
  const viewport = page.viewportSize()!;
  const shell = await page.locator('.app-shell').boundingBox();
  expect(shell!.width).toBe(viewport.width);
  expect(shell!.height).toBe(viewport.height);
  const main = await page.locator('main').boundingBox();
  expect(main!.x + main!.width).toBeLessThanOrEqual(viewport.width);
  expect(main!.y + main!.height).toBeLessThanOrEqual(viewport.height);
}

for (const viewport of [
  { width: 320, height: 640 },
  { width: 393, height: 750 },
  { width: 732, height: 1314 }, // Screenshot-sized / wide mobile layout.
  { width: 980, height: 1314 }, // Mobile browser's desktop-site viewport.
  { width: 1440, height: 900 },
]) {
  test(`navigation and task controls remain reachable at ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport);
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto('/');
    await expectShellFits(page);
    const nav = page.getByRole('navigation', { name: 'Main navigation' });
    const composer = page.getByPlaceholder('Ask anything or discuss attached files...');
    await expectUsable(composer);
    await expectUsable(page.getByRole('button', { name: 'Select active model' }));

    for (let cycle = 0; cycle < 2; cycle++) {
      await nav.getByRole('button', { name: 'Tasks', exact: true }).click();
      await expect(nav.getByRole('button', { name: 'Tasks', exact: true })).toHaveAttribute('aria-current', 'page');
      await expect(composer).toHaveCount(0);
      await expect(page.getByRole('heading', { name: 'Agent Workflows' })).toBeVisible();
      const run = page.getByRole('button', { name: 'Run Workflow', exact: true });
      await run.scrollIntoViewIfNeeded();
      await expectUsable(run);
      const editor = page.getByPlaceholder('Task instructions...');
      await editor.fill('Explain this TypeScript function.');
      const jump = page.getByRole('button', { name: 'Open in Interactive Chat' });
      await jump.scrollIntoViewIfNeeded();
      await expectUsable(jump);

      await nav.getByRole('button', { name: 'Models', exact: true }).click();
      await expect(page.getByRole('heading', { name: 'Add Model', exact: true })).toBeVisible();
      await expect(editor).toHaveCount(0);
      await expectShellFits(page);
      await nav.getByRole('button', { name: 'Settings', exact: true }).click();
      await expectUsable(page.getByRole('button', { name: 'Model Parameters', exact: true }));
      await expectShellFits(page);
      await nav.getByRole('button', { name: 'Chat', exact: true }).click();
      await expectUsable(composer);
      await expect(page.getByRole('heading', { name: 'Agent Workflows' })).toHaveCount(0);
    }
    expect(errors).toEqual([]);
  });
}

for (const provider of ['custom', 'gemini']) {
  test(`saved ${provider} model and chat composer fit a resized mobile viewport`, async ({ page }) => {
    await page.setViewportSize({ width: 393, height: 750 });
    await page.addInitScript((provider) => {
      localStorage.setItem('agentpro_cleared_all_models_v6', 'true');
      localStorage.setItem('agentpro_models_v1', JSON.stringify([{
        id: 'test-model', name: 'Custom model with a long display name', provider,
        providerModelId: 'test-model', isUserSaved: true, isFree: true,
        description: 'Layout fixture', contextLength: 4096, category: 'general',
      }]));
      localStorage.setItem('agentpro_saved_model_ids_v1', '["test-model"]');
      localStorage.setItem('agentpro_active_model_v1', 'test-model');
    }, provider);
    await page.goto('/');
    const picker = page.getByRole('button', { name: 'Select active model' });
    await expectUsable(picker);
    await picker.click();
    const add = page.getByRole('button', { name: 'Add API (Name, Api, Model)', exact: true });
    await expectUsable(add);
    await page.getByRole('button', { name: 'Custom model with a long display name test-model' }).click();
    await expect(picker).toHaveAttribute('aria-expanded', 'false');

    const composer = page.getByPlaceholder('Ask anything or discuss attached files...');
    await composer.fill('Hello');
    // Emulate the layout viewport shrinking when the virtual keyboard opens.
    await page.setViewportSize({ width: 393, height: 430 });
    await expectShellFits(page);
    await expectUsable(composer);
    await expectUsable(page.getByRole('button', { name: 'Send message (⬆️)' }));
    await page.setViewportSize({ width: 750, height: 393 });
    await expectShellFits(page);
    await expectUsable(composer);
    await expectUsable(picker);
  });
}

test('desktop sidebar collapse survives resizing to mobile', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Collapse sidebar' }).click();
  await expect(page.locator('aside')).toHaveCSS('width', '48px');
  await page.setViewportSize({ width: 393, height: 750 });
  await expect(page.locator('aside')).toHaveCSS('width', '393px');
  for (const name of ['Chat', 'Tasks', 'Models', 'Settings']) {
    const button = page.getByRole('navigation').getByRole('button', { name, exact: true });
    await expectUsable(button);
    await expect(button.locator('span').first()).toBeVisible();
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByRole('button', { name: 'Expand sidebar' }).click();
  await expect(page.locator('aside')).toHaveCSS('width', '144px');
});

test('touch browsers avoid nested backdrop blur even in desktop-site mode', async ({ browser }) => {
  const context = await browser.newContext({
    viewport: { width: 980, height: 1314 }, isMobile: true, hasTouch: true,
  });
  const page = await context.newPage();
  await page.goto('http://127.0.0.1:3000');
  await expect(page.locator('header')).toHaveCSS('backdrop-filter', 'none');
  // Tailwind backdrop-blur utilities (model dropdown panel) must also be
  // disabled on touch devices to avoid ghost-panel compositing artifacts.
  const picker = page.getByRole('button', { name: 'Select active model' });
  await expectUsable(picker);
  await picker.tap();
  const blurredPanel = page.locator('[class*="backdrop-blur"]').first();
  await expect(blurredPanel).toBeVisible();
  await expect(blurredPanel).toHaveCSS('backdrop-filter', 'none');
  await page.getByRole('navigation').getByRole('button', { name: 'Tasks', exact: true }).tap();
  const run = page.getByRole('button', { name: 'Run Workflow', exact: true });
  await run.scrollIntoViewIfNeeded();
  await expectUsable(run);
  await context.close();
});
