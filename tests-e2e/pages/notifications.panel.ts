/**
 * Bugasura's notification overlay - the panel behind the bell in the top bar.
 *
 * A COMPONENT, NOT A SCREEN, which is why it is its own class rather than methods
 * on ProjectsPage. The bell is in the signed-in chrome and the recordings open this
 * panel from at least two routes - /apps (TC_LOGIN_074, TC_DASHBOARD_006) and
 * /issues/<id> (TC_DASHBOARD_003, which clicked a project card first). The URL never
 * changes when it opens, so no route owns it and neither of those screens' page
 * objects should claim it.
 *
 * The bell itself lives on WorkspacePage: it is nav chrome, next to projectsLink(),
 * and it is what a person presses to get here. This class starts at the panel.
 */

import type { Locator, Page } from '@playwright/test';

import type { HealingRecorder } from '../support/resilient-locator';
import { BasePage } from './base.page';

export class NotificationsPanel extends BasePage {
  constructor(page: Page, healing?: HealingRecorder) {
    super(page, healing);
  }

  /**
   * The overlay itself, open or closed.
   *
   * One candidate, deliberately. `#ap_notifications_panel` is an authored id that
   * measured exactly one element in every recording that touched it, and the only
   * alternatives the DOM offers are its classes - `modal left fade is-settings-open
   * in`, of which `fade`, `in` and `is-settings-open` are STATE. A fallback built on
   * those resolves when the panel happens to be in one state and silently fails in
   * another, which is worse than the honest failure this gives.
   */
  panel(): Promise<Locator> {
    return this.resolve('notifications.panel', [
      { strategy: '#ap_notifications_panel', build: page => page.locator('#ap_notifications_panel') },
    ]);
  }

  /**
   * The control that switches the panel to its preferences view.
   *
   * Searched INSIDE the panel first. A page-wide search for a button by name is how
   * a locator in this application ends up pressing something else entirely - the
   * lesson the "Sign in with Google" incident left behind - and this panel is open
   * by the time anybody reaches this control. The unscoped query is kept as the
   * second candidate because it is what the recordings measured, at exactly one
   * element.
   */
  settingsButton(): Promise<Locator> {
    return this.resolve('notifications.settingsButton', [
      {
        strategy: "#ap_notifications_panel getByRole('button', { name: 'Notification settings' })",
        build: page => page.locator('#ap_notifications_panel')
            .getByRole('button', { name: 'Notification settings' }),
      },
      {
        strategy: "getByRole('button', { name: 'Notification settings' })",
        build: page => page.getByRole('button', { name: 'Notification settings' }),
      },
    ]);
  }
}
