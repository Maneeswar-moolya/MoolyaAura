/**
 * A Bugasura project's issue list - https://my.bugasura.io/issues/<projectId>
 *
 * Reached via `ProjectsPage.openProject(name)`, which already waits for the
 * `/issues/` URL - this page object only drives what happens once you're there.
 */

import type { Locator, Page } from '@playwright/test';

import type { HealingRecorder } from '../support/resilient-locator';
import { BasePage } from './base.page';

export class IssuesPage extends BasePage {
  constructor(page: Page, healing?: HealingRecorder) {
    super(page, healing);
  }

  /**
   * The issue-list search box (`#filter-value`, placeholder "Search"). Its
   * accessible name is also "Search" and, unlike the login form's fields,
   * there is only one copy of this one on the page - no hidden duplicate to
   * scope away.
   */
  searchField(): Promise<Locator> {
    return this.resolve('issues.searchField', [
      { strategy: "getByRole('textbox', { name: 'Search' })", build: page => page.getByRole('textbox', { name: 'Search' }) },
      { strategy: '#filter-value', build: page => page.locator('#filter-value') },
    ]);
  }

  /** Type a term into the search box and submit it the way a person would. */
  async search(term: string): Promise<void> {
    const field = await this.searchField();
    await field.fill(term);
    await field.press('Enter');
  }

  /**
   * Real issue rows currently listed, excluding drafts.
   *
   * The table (`#bugReport-table`) renders both real issues (`id="tr_<id>"`)
   * and, above them, up to three unsaved drafts (`id="draft_row_<id>"` /
   * `id="draft_header"`) under the SAME row class `.tabulator-row` - an
   * unfiltered `.tabulator-row` count includes drafts that were never
   * submitted and are not the "resulted issue" a search is asking about.
   */
  resultRows(): Locator {
    return this.page.locator('#bugReport-table .tabulator-row[id^="tr_"]');
  }

  /**
   * The status badge inside one result row.
   *
   * Each row renders the status TWICE under the same class `.bug__bage` - a
   * `.mobile.visible-xs` copy for narrow layouts (its text is empty; the
   * status lives in `data-bage-type` there) and the desktop one, which alone
   * carries the visible text ("New", "Assigned", ...). Excluding `.mobile`
   * is what keeps this to exactly one match per row.
   */
  rowStatus(row: Locator): Locator {
    return row.locator('.bug__bage:not(.mobile)');
  }

  /**
   * The state of the control in one issue row, addressed by its description.
   *
   * Composed from the container the caller names, not from a row id: the
   * recorded ids belong to individual issues and change with the data. The
   * description is what identifies the row, and it is the caller's to supply.
   *
   * Measured at the press in 4 recording(s): one element, in the
   * document the press happened in, and that element is the one acted on.
   */
  issueCheckboxState(description: string): Locator {
    return this.page.locator('.tabulator-row')
        .filter({ hasText: description })
        .locator('.bugChecked');
  }

  /**
   * The control in one issue row, addressed by its description.
   *
   * Composed from the container the caller names, not from a row id: the
   * recorded ids belong to individual issues and change with the data. The
   * description is what identifies the row, and it is the caller's to supply.
   *
   * Measured at the press in 4 recording(s): one element, in the
   * document the press happened in, and that element is the one acted on.
   */
  issueCheckbox(description: string): Locator {
    return this.page.locator('.tabulator-row')
        .filter({ hasText: description })
        .locator('.rounded-checkbox-ui');
  }

  /**
   * The control in one issue row, addressed by its name.
   *
   * Composed from the container the caller names, not from a row id: the
   * recorded ids belong to individual issues and change with the data. The
   * name is what identifies the row, and it is the caller's to supply.
   *
   * Measured at the press in 6 recording(s): one element, in the
   * document the press happened in, and that element is the one acted on.
   */
  issueRow(name: string): Locator {
    return this.page.locator('#bugReport-table .bug-report__summary--text.hidden-xs').getByText(name);
  }
}
