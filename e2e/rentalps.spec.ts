import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("Status unit real-time")).toBeVisible();
  await expect(page.getByText(/Mode demo/).first()).toBeVisible();
});

test("adds a tariff and keeps it visible in the demo management page", async ({ page }) => {
  await page.getByRole("button", { name: "Tarif", exact: true }).first().click();
  await expect(page.getByRole("heading", { name: "Kelola Tarif" })).toBeVisible();
  await page.getByRole("button", { name: /Tambah Tarif/ }).click();
  await page.getByLabel("Nama tarif").fill("E2E Paket PS5");
  await page.getByLabel("Harga paket / durasi (Rp)").fill("18000");
  await page.getByLabel("Harga per jam (Rp)").fill("18000");
  await page.getByRole("button", { name: "Simpan", exact: true }).click();
  await expect(page.getByText("E2E Paket PS5")).toBeVisible();
  await expect(page.getByText("Tarif ditambahkan.")).toBeVisible();
});

test("completes a rental session and prints an accurate change receipt", async ({ page }) => {
  await page.getByRole("button", { name: /Mulai sesi/ }).click();
  const startModal = page.locator(".modal");
  await expect(startModal.getByRole("heading", { name: "Mulai Sesi Baru" })).toBeVisible();
  await startModal.getByPlaceholder("Masukkan nama pelanggan").fill("Pelanggan E2E");
  await startModal.locator(".duration-grid").last().getByRole("button", { name: /^1 jam/ }).click();
  await startModal.getByRole("button", { name: "Mulai sesi" }).click();
  await expect(page.getByText("Sesi demo berhasil dimulai.")).toBeVisible();

  await page.getByRole("button", { name: "Aksi PS 03" }).click();
  const endModal = page.locator(".modal");
  await expect(endModal.getByRole("heading", { name: "Akhiri dan Bayar" })).toBeVisible();
  const receivedInput = endModal.locator('input[inputmode="numeric"]');
  await receivedInput.fill("15000");
  await endModal.getByRole("button", { name: "Akhiri & bayar" }).click();

  const receipt = page.locator(".receipt-paper");
  await expect(receipt.getByText("LUNAS")).toBeVisible();
  await expect(receipt.getByText("Pelanggan E2E")).toBeVisible();
  await expect(receipt.getByText("Kembalian")).toBeVisible();
  await expect(receipt.getByText(/5\\.000/)).toBeVisible();
  await expect(receipt.getByRole("button", { name: "Cetak struk" })).toBeVisible();
});

test("loads F&B and reservation pages and exports CSV, Excel-compatible and PDF reports", async ({ page }) => {
  await page.getByRole("button", { name: "F&B", exact: true }).first().click();
  await expect(page.getByRole("heading", { name: "F&B / Kasir Tambahan" })).toBeVisible();
  await expect(page.getByText("Air Mineral")).toBeVisible();

  await page.getByRole("button", { name: "Reservasi", exact: true }).first().click();
  await expect(page.getByRole("heading", { name: "Reservasi", level: 2 })).toBeVisible();

  await page.getByRole("button", { name: "Laporan", exact: true }).first().click();
  await expect(page.getByRole("heading", { name: "Laporan", level: 2 })).toBeVisible();
  for (const [label, extension] of [["CSV", ".csv"], ["Excel", ".xls"], ["PDF", ".pdf"]] as const) {
    const downloadEvent = page.waitForEvent("download");
    await page.getByRole("button", { name: label, exact: true }).click();
    const download = await downloadEvent;
    expect(download.suggestedFilename()).toMatch(new RegExp(extension.replace(".", "\\.") + "$"));
  }
});
