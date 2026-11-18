import { expect } from '@playwright/test';

// The everyday ways of reaching a command, shared by the desktop suites, so one change to the
// interface means one change here. All of them take the page, which some suites replace on restart.
export const closeToast = async (page) => {
  const close = page.getByRole('button', { name: '关闭提示', exact: true });
  if (await close.isVisible()) await close.click();
};
// 更多工具 menu in the header.
export const more = async (page, label) => {
  await page.getByLabel('更多工具', { exact: true }).click();
  await page.getByRole('button', { name: label, exact: true }).click();
};
export const fileMenu = (page) => page.getByRole('menu', { name: '文件操作', exact: true });
export const backgroundMenu = (page) => page.getByRole('menu', { name: '画布操作', exact: true });
// Right-click on a card or row.
export const cardAction = async (page, target, label) => {
  await target.click({ button: 'right' });
  await fileMenu(page).getByRole('menuitem', { name: label, exact: true }).click();
};
// 操作 in the selection bar.
export const selectionAction = async (page, label) => {
  await page.getByRole('button', { name: '所选文件操作', exact: true }).click();
  await fileMenu(page).getByRole('menuitem', { name: label, exact: true }).click();
};
// Right-click on an empty part of the canvas.
export const blankAction = async (page, label) => {
  await closeToast(page);
  const surface = page.locator('.canvas-scroll');
  const box = await surface.boundingBox();
  await surface.click({ button: 'right', position: { x: box.width - 22, y: box.height - 24 } });
  await backgroundMenu(page).getByRole('menuitem', { name: label, exact: true }).click();
};
// 视图选项 / 画布选项 button above the cards.
export const viewOption = async (page, label) => {
  await page.getByRole('button', { name: /^(视图|画布)选项/ }).click();
  await backgroundMenu(page).getByRole('menuitem', { name: label }).click();
};
export const inspect = async (page, target) => {
  await cardAction(page, target, '预览详情');
  await expect(page.locator('.file-inspector')).toBeVisible();
};
export const settingsPanel = (page) => page.getByRole('dialog', { name: '界面设置' });
export const openSettings = async (page) => {
  await more(page, '界面设置');
  await expect(settingsPanel(page)).toBeVisible();
};
// Tiles and groups only get a button of their own while chosen; settings offers all four.
export const chooseView = async (page, label) => {
  const button = page.getByRole('button', { name: `${label}视图` });
  if (await button.count()) return button.click();
  await openSettings(page);
  await settingsPanel(page).getByRole('radio', { name: label, exact: true }).click();
  await settingsPanel(page).getByRole('button', { name: '完成' }).click();
  await expect(settingsPanel(page)).toHaveCount(0);
};
export const finishReport = async (page) => {
  const report = page.getByRole('dialog', { name: '整理完成', exact: true });
  await expect(report).toBeVisible({ timeout: 20000 });
  await report.getByRole('button', { name: '完成', exact: true }).click();
  await expect(report).toHaveCount(0);
};
