/**
 * Face Library page tests -- HIGH tier.
 *
 * Collection selector, face tiles, grouped recent-recognition dialog
 * (migrated from radix-overlay-regressions.spec.ts), and mobile
 * library selector.
 */

import { type Locator } from "@playwright/test";
import { FACE_VIDEO_SEGMENT } from "../fixtures/mock-data/face-video";
import { test, expect, type FrigateApp } from "../fixtures/frigate-test";
import {
  basicFacesMock,
  emptyFacesMock,
  withGroupedTrainingAttempt,
} from "../fixtures/mock-data/faces";
import {
  expectBodyInteractive,
  waitForBodyInteractive,
} from "../helpers/overlay-interaction";

const GROUPED_EVENT_ID = "1775487131.3863528-abc123";

function groupedFacesMock() {
  return withGroupedTrainingAttempt(basicFacesMock(), {
    eventId: GROUPED_EVENT_ID,
    attempts: [
      { timestamp: 1775487131.3863528, label: "unknown", score: 0.95 },
      { timestamp: 1775487132.3863528, label: "unknown", score: 0.91 },
    ],
  });
}

const GROUPED_EVENT = {
  id: GROUPED_EVENT_ID,
  label: "person",
  sub_label: null,
  camera: "front_door",
  start_time: 1775487131.3863528,
  end_time: 1775487161.3863528,
  false_positive: false,
  zones: ["front_yard"],
  thumbnail: null,
  has_clip: true,
  has_snapshot: true,
  retain_indefinitely: false,
  plus_id: null,
  model_hash: "abc123",
  detector_type: "cpu",
  model_type: "ssd",
  data: {
    top_score: 0.92,
    score: 0.92,
    region: [0.1, 0.1, 0.5, 0.8],
    box: [0.2, 0.15, 0.45, 0.75],
    area: 0.18,
    ratio: 0.6,
    type: "object",
    path_data: [],
  },
};

async function installGroupedFaces(
  app: FrigateApp,
  opts: { withEventIds?: boolean } = {},
) {
  await app.api.install({
    events: [GROUPED_EVENT],
    faces: groupedFacesMock(),
  });

  // Return metadata only when the test needs the associated event. Missing
  // metadata is an empty list, so no request reaches the preview server.
  await app.page.route("**/api/event_ids**", (route) =>
    route.fulfill({ json: opts.withEventIds ? [GROUPED_EVENT] : [] }),
  );
}

async function openGroupedFaceDialog(app: FrigateApp): Promise<Locator> {
  await installGroupedFaces(app);
  await app.goto("/faces");
  const groupedImage = app.page
    .locator('img[src*="clips/faces/train/"]')
    .first();
  const groupedCard = groupedImage.locator("xpath=..");
  await expect(groupedImage).toBeVisible({ timeout: 5_000 });
  await groupedCard.click();
  const dialog = app.page
    .getByRole("dialog")
    .filter({ has: app.page.locator('img[src*="clips/faces/train/"]') })
    .first();
  await expect(dialog).toBeVisible({ timeout: 5_000 });
  await expect(dialog.locator('img[src*="clips/faces/train/"]')).toHaveCount(2);
  return dialog;
}

/**
 * Opens the LibrarySelector dropdown (the single button at the top-left of
 * the Face Library page) and returns the dropdown menu locator.
 *
 * The LibrarySelector is a single DropdownMenu whose trigger shows the
 * current tab name + count (e.g. "Recent Recognitions (0)"). Named face
 * collections (alice, bob, charlie) are items inside this dropdown.
 */
async function openLibraryDropdown(app: FrigateApp): Promise<Locator> {
  // The trigger is the first button on the page with a parenthesised count.
  const trigger = app.page
    .getByRole("button")
    .filter({ hasText: /\(\d+\)/ })
    .first();
  await expect(trigger).toBeVisible({ timeout: 10_000 });
  await trigger.click();
  const menu = app.page
    .locator('[role="menu"], [data-radix-menu-content]')
    .first();
  await expect(menu).toBeVisible({ timeout: 5_000 });
  return menu;
}

test.describe("Face Library — collection selector @high", () => {
  test("selector shows named face collections", async ({ frigateApp }) => {
    await frigateApp.installDefaults({ faces: basicFacesMock() });
    await frigateApp.goto("/faces");
    // Named collections appear in the LibrarySelector dropdown.
    const menu = await openLibraryDropdown(frigateApp);
    await expect(menu.getByText(/alice/i).first()).toBeVisible({
      timeout: 5_000,
    });
  });

  test("empty state renders when no faces exist", async ({ frigateApp }) => {
    await frigateApp.installDefaults({ faces: emptyFacesMock() });
    await frigateApp.goto("/faces");
    await expect(frigateApp.page.locator("#pageRoot")).toBeVisible();
    await expect(
      frigateApp.page.locator('img[src*="/clips/faces/"]'),
    ).toHaveCount(0);
  });

  test("tiles render for each named collection", async ({ frigateApp }) => {
    await frigateApp.installDefaults({ faces: basicFacesMock() });
    await frigateApp.goto("/faces");
    // Open the dropdown — collections list shows "alice (2)" and "bob (1)".
    const menu = await openLibraryDropdown(frigateApp);
    await expect(
      menu.locator('[role="menuitem"]').filter({ hasText: /alice/i }).first(),
    ).toBeVisible({ timeout: 5_000 });
    await expect(
      menu.locator('[role="menuitem"]').filter({ hasText: /bob/i }).first(),
    ).toBeVisible();
  });
});

test.describe("Face Library — delete flow (desktop) @high", () => {
  test.skip(
    ({ frigateApp }) => frigateApp.isMobile,
    "Delete action menu is desktop-focused",
  );

  test("deleting a collection fires POST /faces/<name>/delete", async ({
    frigateApp,
  }) => {
    let deleteUrl: string | null = null;
    let deleteBody: unknown = null;
    // Install base mocks first, then register our more-specific route AFTER
    // so it takes priority over the ApiMocker catch-all (Playwright LIFO order).
    await frigateApp.installDefaults({ faces: basicFacesMock() });
    await frigateApp.page.route(
      /\/api\/faces\/[^/]+\/delete/,
      async (route) => {
        deleteUrl = route.request().url();
        deleteBody = route.request().postDataJSON();
        await route.fulfill({ json: { success: true } });
      },
    );
    await frigateApp.goto("/faces");

    // Open the LibrarySelector dropdown and click the trash icon next
    // to the alice row. The trash icon is a ghost-variant Button inside
    // the DropdownMenuItem — it becomes visible on hover/focus.
    const menu = await openLibraryDropdown(frigateApp);
    const aliceRow = menu
      .locator('[role="menuitem"]')
      .filter({ hasText: /alice/i })
      .first();
    await expect(aliceRow).toBeVisible({ timeout: 5_000 });
    // Hover first to make hover-only opacity-0 buttons visible.
    await aliceRow.hover();
    // The icon buttons have no aria-label or title. The row renders exactly
    // two buttons in fixed source order: [0] LuPencil (rename), [1] LuTrash2
    // (delete). This order is determined by FaceLibrary.tsx and is stable.
    const trashBtn = aliceRow.locator("button").nth(1);
    await trashBtn.click();

    // The delete confirmation is a Dialog (not AlertDialog) in this flow.
    const dialog = frigateApp.page.getByRole("dialog");
    await expect(dialog).toBeVisible({ timeout: 5_000 });
    await dialog
      .getByRole("button", { name: /delete/i })
      .first()
      .click();

    await expect
      .poll(() => deleteUrl, { timeout: 5_000 })
      .toMatch(/\/faces\/alice\/delete/);
    expect(deleteBody).toMatchObject({ ids: expect.any(Array) });
  });
});

test.describe("Face Library — rename flow (desktop) @high", () => {
  test.skip(
    ({ frigateApp }) => frigateApp.isMobile,
    "Rename action menu is desktop-focused",
  );

  test("renaming a collection fires PUT /faces/<name>/rename", async ({
    frigateApp,
  }) => {
    let renameUrl: string | null = null;
    let renameBody: unknown = null;
    // Install base mocks first, then register our more-specific route AFTER
    // so it takes priority over the ApiMocker catch-all (Playwright LIFO order).
    await frigateApp.installDefaults({ faces: basicFacesMock() });
    await frigateApp.page.route(
      /\/api\/faces\/[^/]+\/rename/,
      async (route) => {
        renameUrl = route.request().url();
        renameBody = route.request().postDataJSON();
        await route.fulfill({ json: { success: true } });
      },
    );
    await frigateApp.goto("/faces");

    // Open the LibrarySelector dropdown and click the pencil (rename) icon
    // next to alice. The icon is a ghost Button inside the DropdownMenuItem.
    const menu = await openLibraryDropdown(frigateApp);
    const aliceRow = menu
      .locator('[role="menuitem"]')
      .filter({ hasText: /alice/i })
      .first();
    await expect(aliceRow).toBeVisible({ timeout: 5_000 });
    await aliceRow.hover();
    // The icon buttons have no aria-label or title. The row renders exactly
    // two buttons in fixed source order: [0] LuPencil (rename), [1] LuTrash2
    // (delete). This order is determined by FaceLibrary.tsx and is stable.
    const pencilBtn = aliceRow.locator("button").nth(0);
    await pencilBtn.click();

    // TextEntryDialog — fill the input and confirm.
    const dialog = frigateApp.page.getByRole("dialog");
    await expect(dialog).toBeVisible({ timeout: 5_000 });
    await dialog.locator("input").first().fill("alice_renamed");
    await dialog
      .getByRole("button", { name: /save|rename|confirm/i })
      .first()
      .click();

    await expect
      .poll(() => renameUrl, { timeout: 5_000 })
      .toMatch(/\/faces\/alice\/rename/);
    expect(renameBody).toEqual({ new_name: "alice_renamed" });
  });
});

test.describe("Face Library — upload flow @high", () => {
  test.skip(
    ({ frigateApp }) => frigateApp.isMobile,
    "Upload button has no accessible text on mobile — icon-only on narrow viewports",
  );

  test("Upload button opens the upload dialog", async ({ frigateApp }) => {
    await frigateApp.installDefaults({ faces: basicFacesMock() });
    await frigateApp.goto("/faces");

    // Navigate to the alice tab by opening the dropdown and clicking alice.
    const menu = await openLibraryDropdown(frigateApp);
    await menu
      .locator('[role="menuitem"]')
      .filter({ hasText: /alice/i })
      .first()
      .click();

    // After switching to alice, the Upload Image button appears in the toolbar.
    const uploadBtn = frigateApp.page
      .getByRole("button")
      .filter({ hasText: /upload/i })
      .first();
    await expect(uploadBtn).toBeVisible({ timeout: 5_000 });
    await uploadBtn.click();

    // UploadImageDialog renders a file input + confirm button.
    const dialog = frigateApp.page.getByRole("dialog");
    await expect(dialog).toBeVisible({ timeout: 5_000 });
    await expect(dialog.locator('input[type="file"]')).toHaveCount(1);
  });
});

test.describe("FaceSelectionDialog @high", () => {
  test.skip(
    ({ frigateApp }) => frigateApp.isMobile,
    "Grouped dropdown flow is desktop-only",
  );

  test("reclassify dropdown selects a name and closes cleanly", async ({
    frigateApp,
  }) => {
    // Migrated from radix-overlay-regressions.spec.ts.
    const dialog = await openGroupedFaceDialog(frigateApp);
    const triggers = dialog.locator('[aria-haspopup="menu"]');
    await expect(triggers).toHaveCount(2);

    await triggers.first().click();
    const menu = frigateApp.page
      .locator('[role="menu"], [data-radix-menu-content]')
      .first();
    await expect(menu).toBeVisible({ timeout: 5_000 });

    await menu.getByRole("menuitem", { name: /^bob$/i }).click();

    await expect(menu).not.toBeVisible({ timeout: 3_000 });
    await expect(dialog).toBeVisible();

    const tooltipVisible = await frigateApp.page
      .locator('[role="tooltip"]')
      .filter({ hasText: /train face/i })
      .isVisible()
      .catch(() => false);
    expect(
      tooltipVisible,
      "Train Face tooltip popped after dropdown closed — focus-restore regression",
    ).toBe(false);
  });

  test("second dropdown open accepts typeahead keyboard input", async ({
    frigateApp,
  }) => {
    // Migrated from radix-overlay-regressions.spec.ts.
    const dialog = await openGroupedFaceDialog(frigateApp);
    const triggers = dialog.locator('[aria-haspopup="menu"]');
    await expect(triggers).toHaveCount(2);

    await triggers.first().click();
    let menu = frigateApp.page
      .locator('[role="menu"], [data-radix-menu-content]')
      .first();
    await expect(menu).toBeVisible({ timeout: 5_000 });
    await menu.getByRole("menuitem", { name: /^bob$/i }).click();
    await expect(menu).not.toBeVisible({ timeout: 3_000 });

    await triggers.nth(1).click();
    menu = frigateApp.page
      .locator('[role="menu"], [data-radix-menu-content]')
      .first();
    await expect(menu).toBeVisible({ timeout: 5_000 });

    await frigateApp.page.keyboard.press("c");
    await expect
      .poll(
        async () =>
          frigateApp.page.evaluate(
            () =>
              document.activeElement?.textContent?.trim().toLowerCase() ?? "",
          ),
        { timeout: 2_000 },
      )
      .toMatch(/^charlie/);

    await frigateApp.page.keyboard.press("Escape");
    await expect(menu).not.toBeVisible({ timeout: 3_000 });
  });

  test("classifying the last image in a group leaves body interactive", async ({
    frigateApp,
  }) => {
    // Regression guard for the stuck body pointer-events bug when the
    // last image in a grouped-recognition detail Dialog is classified.
    // Tracked upstream at radix-ui/primitives#3445.
    //
    // Root cause: when the user clicks a FaceSelectionDialog menu item,
    // the modal DropdownMenu enters its exit animation (Radix's Presence
    // keeps it in the DOM with data-state="closed" until animationend).
    // While that is in flight the classify axios resolves, SWR removes
    // the image from /api/faces, the parent's map no longer renders the
    // grouped card, and React unmounts the subtree — including the still-
    // animating DropdownMenu's Presence container. DismissableLayer's
    // shared modal-layer stack can't reconcile the interrupted exit, so
    // the `body { pointer-events: none }` entry it put on mount is never
    // popped and the rest of the UI becomes unclickable.
    //
    // The fix is `modal={false}` on the FaceSelectionDialog's
    // DropdownMenu (desktop path only). With modal=false the DropdownMenu
    // never puts an entry on DismissableLayer's body-pointer-events stack
    // in the first place, so there's nothing to leak when its Presence is
    // torn down mid-animation. The Radix-community-documented workaround
    // for #3445.
    //
    // The bug only reproduces when the mock resolves fast enough that
    // the parent unmounts before the dropdown's exit animation finishes.
    // Measured window via a 3x sweep on the pre-fix build: 0–200 ms
    // triggers it; 300 ms+ no longer reproduces. Production LAN networks
    // sit comfortably inside the bad window, while `npm run dev` seems
    // to mask it via React StrictMode's double-effect scheduling.
    const EVENT_ID = "1775487131.3863528-race";
    const initialFaces = withGroupedTrainingAttempt(basicFacesMock(), {
      eventId: EVENT_ID,
      attempts: [
        { timestamp: 1775487131.3863528, label: "unknown", score: 0.95 },
      ],
    });

    let classified = false;

    await frigateApp.installDefaults({
      faces: initialFaces,
      events: [
        {
          id: EVENT_ID,
          label: "person",
          sub_label: null,
          camera: "front_door",
          start_time: 1775487131.3863528,
          end_time: 1775487161.3863528,
          false_positive: false,
          zones: ["front_yard"],
          thumbnail: null,
          has_clip: true,
          has_snapshot: true,
          retain_indefinitely: false,
          plus_id: null,
          model_hash: "abc123",
          detector_type: "cpu",
          model_type: "ssd",
          data: {
            top_score: 0.92,
            score: 0.92,
            region: [0.1, 0.1, 0.5, 0.8],
            box: [0.2, 0.15, 0.45, 0.75],
            area: 0.18,
            ratio: 0.6,
            type: "object",
            path_data: [],
          },
        },
      ],
    });

    await frigateApp.page.route("**/api/event_ids**", (route) =>
      route.fulfill({ json: [] }),
    );

    // Re-route /api/faces to flip to the "train empty" payload once the
    // classify POST has been received. Registered AFTER installDefaults so
    // Playwright's LIFO route matching hits this handler first.
    await frigateApp.page.route("**/api/faces", async (route) => {
      const payload = classified ? basicFacesMock() : initialFaces;
      await route.fulfill({ json: payload });
    });

    // Hold the classify POST briefly. The race opens when the parent
    // unmounts before the dropdown's exit animation finishes (~200ms
    // in Radix). 100ms keeps us comfortably inside that window and
    // reliably triggered the bug in a 3x sweep across 0/50/100/200ms
    // on the pre-fix build. CLASSIFY_DELAY_MS overrides for local sweeps.
    const delayMs = Number(
      (globalThis as { process?: { env?: Record<string, string> } }).process
        ?.env?.CLASSIFY_DELAY_MS ?? "100",
    );
    await frigateApp.page.route(
      "**/api/faces/train/*/classify",
      async (route) => {
        classified = true;
        if (delayMs > 0) {
          await new Promise((resolve) => setTimeout(resolve, delayMs));
        }
        await route.fulfill({ json: { success: true } });
      },
    );

    await frigateApp.goto("/faces");

    // Open the grouped detail Dialog.
    const groupedImage = frigateApp.page
      .locator('img[src*="clips/faces/train/"]')
      .first();
    await expect(groupedImage).toBeVisible({ timeout: 5_000 });
    await groupedImage.locator("xpath=..").click();
    const dialog = frigateApp.page
      .getByRole("dialog")
      .filter({
        has: frigateApp.page.locator('img[src*="clips/faces/train/"]'),
      })
      .first();
    await expect(dialog).toBeVisible({ timeout: 5_000 });

    // Single attempt → single `+` trigger.
    const triggers = dialog.locator('[aria-haspopup="menu"]');
    await expect(triggers).toHaveCount(1);
    await triggers.first().click();

    const menu = frigateApp.page
      .locator('[role="menu"], [data-radix-menu-content]')
      .first();
    await expect(menu).toBeVisible({ timeout: 5_000 });
    await menu.getByRole("menuitem", { name: /^alice$/i }).click();

    // The Dialog must leave the tree cleanly, and body must recover.
    await expect(dialog).not.toBeVisible({ timeout: 5_000 });

    // Give Radix's exit animation + cleanup a comfortable margin on top of
    // the ~300ms simulated network delay.
    await waitForBodyInteractive(frigateApp.page, 5_000);
    await expectBodyInteractive(frigateApp.page);

    // User-visible confirmation: click something outside the dialog
    // and assert it actually responds.
    const librarySelector = frigateApp.page
      .getByRole("button")
      .filter({ hasText: /\(\d+\)/ })
      .first();
    await librarySelector.click();
    await expect(
      frigateApp.page
        .locator('[role="menu"], [data-radix-menu-content]')
        .first(),
    ).toBeVisible({ timeout: 3_000 });
  });
});

test.describe("Face Library: return from Explore @high", () => {
  test("Explore back button returns to an outlined collection", async ({
    frigateApp,
  }) => {
    await installGroupedFaces(frigateApp, { withEventIds: true });
    await frigateApp.goto("/faces");

    // Mobile opens the collection as a MobilePage, which has no dialog role
    const card = frigateApp.page
      .locator('img[src*="clips/faces/train/"]')
      .first()
      .locator("xpath=..");
    await card.click();
    await frigateApp.page.getByLabel("View in Explore").click();
    await expect(frigateApp.page).toHaveURL(
      new RegExp(`/explore\\?event_id=${GROUPED_EVENT_ID}`),
    );

    const back = frigateApp.page.getByRole("button", { name: "Go back" });
    await expect(back).toBeVisible({ timeout: 5_000 });
    await back.click();
    await expect(frigateApp.page).toHaveURL(/\/faces/);

    await expect(card).toHaveClass(/outline-selected/, { timeout: 5_000 });
    await expect(card).not.toHaveClass(/outline-selected/, { timeout: 5_000 });
  });
});

test.describe("Face Library — mobile @high @mobile", () => {
  test.skip(({ frigateApp }) => !frigateApp.isMobile, "Mobile-only");

  test("mobile library selector dropdown closes cleanly on Escape", async ({
    frigateApp,
  }) => {
    // Migrated from radix-overlay-regressions.spec.ts.
    await installGroupedFaces(frigateApp);
    await frigateApp.goto("/faces");

    const selector = frigateApp.page
      .getByRole("button")
      .filter({ hasText: /\(\d+\)/ })
      .first();
    await expect(selector).toBeVisible({ timeout: 5_000 });
    await selector.click();

    const menu = frigateApp.page
      .locator('[role="menu"], [data-radix-menu-content]')
      .first();
    await expect(menu).toBeVisible({ timeout: 3_000 });

    await frigateApp.page.keyboard.press("Escape");
    await expect(menu).not.toBeVisible({ timeout: 3_000 });
    await waitForBodyInteractive(frigateApp.page);
    await expectBodyInteractive(frigateApp.page);
  });
});

test.describe("Face Library without reference images @high @mobile", () => {
  test("shows unknown detected faces before a named collection exists", async ({
    frigateApp,
  }) => {
    await frigateApp.installDefaults({
      faces: withGroupedTrainingAttempt(
        {},
        {
          eventId: GROUPED_EVENT_ID,
          attempts: [
            { timestamp: 1775487131.3863528, label: "unknown", score: 0 },
          ],
        },
      ),
    });
    await frigateApp.page.route("**/api/event_ids**", (route) =>
      route.fulfill({ json: [GROUPED_EVENT] }),
    );
    await frigateApp.goto("/faces");
    await expect(
      frigateApp.page.locator('img[src*="clips/faces/train/"]'),
    ).toHaveCount(1);
    await expect(
      frigateApp.page.getByText("Unknown", { exact: true }).first(),
    ).toBeVisible();
    await expect(
      frigateApp.page
        .getByRole("button")
        .filter({ hasText: /\(\d+\)/ })
        .first(),
    ).toContainText("1");
  });

  test("explains automatic collection while the library is empty", async ({
    frigateApp,
  }) => {
    await frigateApp.installDefaults({ faces: {} });
    await frigateApp.goto("/faces");
    await expect(
      frigateApp.page.getByText("Waiting for faces", { exact: true }),
    ).toBeVisible();
    await expect(
      frigateApp.page.getByText(
        /Detected faces will appear here, including unknown people/,
      ),
    ).toBeVisible();
  });
});

test.describe("Face video context @high @mobile", () => {
  const capturedAt = GROUPED_EVENT.start_time + 8;
  const playlist =
    "#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:20\n#EXT-X-MEDIA-SEQUENCE:0\n#EXTINF:20.000,\nface-context.ts\n#EXT-X-ENDLIST\n";

  async function installVideo(
    app: FrigateApp,
    options: {
      hasClip?: boolean;
      missingEvent?: boolean;
      available?: boolean;
    } = {},
  ) {
    const state = {
      available: options.available ?? true,
      requests: [] as string[],
    };
    await app.installDefaults({
      faces: withGroupedTrainingAttempt(
        {},
        {
          eventId: GROUPED_EVENT_ID,
          attempts: [{ timestamp: capturedAt, label: "unknown", score: 0 }],
        },
      ),
    });
    await app.page.route("**/api/event_ids**", (route) =>
      route.fulfill({
        json: options.missingEvent
          ? []
          : [{ ...GROUPED_EVENT, has_clip: options.hasClip ?? true }],
      }),
    );
    await app.page.route("**/vod/**", (route) => {
      state.requests.push(route.request().url());
      return route.fulfill(
        new URL(route.request().url()).pathname.endsWith(".ts")
          ? {
              contentType: "video/mp2t",
              body: FACE_VIDEO_SEGMENT,
            }
          : {
              contentType: "application/vnd.apple.mpegurl",
              body: state.available ? playlist : "#EXTM3U\n#EXT-X-ENDLIST\n",
            },
      );
    });
    await app.goto("/faces");
    await app.page
      .locator('img[src*="clips/faces/train/"]')
      .first()
      .locator("xpath=..")
      .click();
    return state;
  }

  async function closeVideoPopup(app: FrigateApp) {
    if (app.isMobile) {
      await app.page
        .getByRole("button", { name: "Go back", exact: true })
        .click();
    } else {
      await app.page
        .getByRole("dialog")
        .getByRole("button", { name: "Close", exact: true })
        .click();
    }
  }

  async function expectPlaying(page: FrigateApp["page"]) {
    const video = page.locator("video");
    await expect(video).toHaveCount(1);
    await expect
      .poll(
        () =>
          video.evaluate((element) => (element as HTMLVideoElement).readyState),
        { timeout: 10000 },
      )
      .toBeGreaterThanOrEqual(2);
    await expect(video).toHaveJSProperty("paused", false);
    await expect
      .poll(() =>
        video.evaluate((element) => (element as HTMLVideoElement).currentTime),
      )
      .toBeGreaterThan(2);
  }

  test("loads and plays the matching recording only on request", async ({
    frigateApp,
  }) => {
    const state = await installVideo(frigateApp);
    const page = frigateApp.page;
    const panel = page.getByRole("region", { name: "Video for this face" });
    await expect(
      panel.getByRole("button", { name: "Show video", exact: true }),
    ).toBeVisible();
    expect(state.requests).toHaveLength(0);
    await expect(page.locator("video")).toHaveCount(0);
    await panel
      .getByRole("button", { name: "Show video", exact: true })
      .click();
    await expectPlaying(page);
    const dimensions = await page.locator("video").evaluate((video) => ({
      video: video.getBoundingClientRect().height,
      viewport: window.innerHeight,
    }));
    expect(dimensions.video).toBeLessThanOrEqual(dimensions.viewport * 0.4 + 1);
    const request = state.requests.find((url) => url.endsWith("index.m3u8"))!;
    const parts = new URL(request).pathname.split("/");
    expect(parts[2]).toBe("front_door");
    expect(Number(parts[4])).toBeCloseTo(capturedAt - 5);
    expect(Number(parts[6])).toBeCloseTo(capturedAt + 15);
    await panel
      .getByRole("button", { name: "Hide video", exact: true })
      .click();
    await expect(page.locator("video")).toHaveCount(0);
    await expect(
      page.getByText("Unknown", { exact: true }).first(),
    ).toBeVisible();
  });

  test("keeps the finished clip visible with its playback controls", async ({
    frigateApp,
  }) => {
    const { page } = frigateApp;
    await installVideo(frigateApp);
    await page.getByRole("button", { name: "Show video", exact: true }).click();
    await expect
      .poll(() =>
        page
          .locator("video")
          .evaluate((video) => (video as HTMLVideoElement).readyState),
      )
      .toBeGreaterThanOrEqual(2);
    await page.locator("video").evaluate((element) => {
      const video = element as HTMLVideoElement;
      video.currentTime = video.duration - 0.25;
    });
    await expect
      .poll(() =>
        page
          .locator("video")
          .evaluate((video) => (video as HTMLVideoElement).ended),
      )
      .toBe(true);
    // Exercise the delayed stalled notification emitted by the shared player.
    await page.waitForTimeout(3500);
    await expect(page.locator("video")).toHaveCount(1);
    await expect(page.locator("video")).toHaveJSProperty("controls", true);
    await expect(
      page.getByText("No recording is available for this face.", {
        exact: false,
      }),
    ).toHaveCount(0);
  });

  test("ignores a delayed buffering notification after playback recovers", async ({
    frigateApp,
  }) => {
    await installVideo(frigateApp);
    const { page } = frigateApp;
    await page.getByRole("button", { name: "Show video", exact: true }).click();
    await expectPlaying(page);
    await page.locator("video").evaluate((element) => {
      element.dispatchEvent(new Event("waiting"));
    });
    await page.waitForTimeout(3500);
    await expectPlaying(page);
  });

  test("closing the face popup removes the player and reopening leaves it optional", async ({
    frigateApp,
  }) => {
    const state = await installVideo(frigateApp);
    const page = frigateApp.page;
    await page.getByRole("button", { name: "Show video", exact: true }).click();
    await expectPlaying(page);
    const detachedVideo = await page.locator("video").elementHandle();
    await closeVideoPopup(frigateApp);
    await expect(page.locator("video")).toHaveCount(0);
    expect(
      await detachedVideo!.evaluate(
        (element) => (element as HTMLVideoElement).paused,
      ),
    ).toBe(true);
    expect(await detachedVideo!.getAttribute("src")).toBeNull();
    const count = state.requests.length;
    await page
      .locator('img[src*="clips/faces/train/"]')
      .first()
      .locator("xpath=..")
      .click();
    await expect(
      page.getByRole("button", { name: "Show video", exact: true }),
    ).toBeVisible();
    await expect(page.locator("video")).toHaveCount(0);
    expect(state.requests.length).toBe(count);
  });

  for (const [label, options] of [
    ["expired recording", { hasClip: false }],
    ["deleted event", { missingEvent: true }],
  ] as const) {
    test(`handles an ${label} without requesting video`, async ({
      frigateApp,
    }) => {
      const state = await installVideo(frigateApp, options);
      await expect(
        frigateApp.page.getByText(/No recording is available for this face/),
      ).toBeVisible();
      await expect(
        frigateApp.page.getByRole("button", {
          name: "Show video",
          exact: true,
        }),
      ).toHaveCount(0);
      expect(state.requests).toHaveLength(0);
    });
  }

  test("shows an unavailable recording and can retry", async ({
    frigateApp,
  }) => {
    const state = await installVideo(frigateApp, { available: false });
    const page = frigateApp.page;
    await page.getByRole("button", { name: "Show video", exact: true }).click();
    await expect(
      page.getByText(/No recording is available for this face/),
    ).toBeVisible();
    await expect(page.locator("video")).toHaveCount(0);
    state.available = true;
    await page.getByRole("button", { name: "Try again", exact: true }).click();
    await expectPlaying(page);
  });

  test.describe("pending request cleanup", () => {
    test.use({ expectedErrors: [/net::ERR_ABORTED .*\/vod\//] });
    test("closing the popup cancels an outstanding recording request", async ({
      frigateApp,
    }) => {
      await installVideo(frigateApp);
      const page = frigateApp.page;
      let release = () => {};
      const waiting = new Promise<void>((resolve) => {
        release = resolve;
      });
      const aborted: string[] = [];
      page.on("requestfailed", (request) => {
        if (
          request.url().includes("/vod/") &&
          request.failure()?.errorText.includes("ABORTED")
        )
          aborted.push(request.url());
      });
      await page.route("**/vod/**/index.m3u8", async (route) => {
        await waiting;
        await route
          .fulfill({
            contentType: "application/vnd.apple.mpegurl",
            body: playlist,
          })
          .catch(() => {});
      });
      try {
        const request = page.waitForRequest("**/vod/**/index.m3u8");
        await page
          .getByRole("button", { name: "Show video", exact: true })
          .click();
        await request;
        await closeVideoPopup(frigateApp);
        await expect.poll(() => aborted.length).toBeGreaterThan(0);
        await expect(page.locator("video")).toHaveCount(0);
      } finally {
        release();
      }
    });
  });
});
