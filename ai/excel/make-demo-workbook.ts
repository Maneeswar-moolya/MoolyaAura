/**
 * Generates the demo input workbook: excel/login-test-cases.xlsx
 *
 * One workbook, one sheet per module - which is how most teams actually keep
 * test cases, and what a client should be handed:
 *
 *   Read Me            prose, not a table. The parser must skip it.
 *   Login Test Cases   TC_LOGIN_001-007
 *   Create Project     TC_PROJ_001-008
 *   Login Validation   TC_LOGIN_010-016, data-driven - no spec is written for these
 *
 * Deliberately awkward in places, so the demo proves something:
 *  - headings are non-standard ("TC ID", "Expected", "Prio") to exercise mapping
 *  - a banner row sits above the header on the Login sheet, but not on Create
 *    Project - the parser has to find the header row either way
 *  - a few rows are genuinely poor test cases, to exercise the quality analyzer
 *  - one row has no Test Case ID at all and must be reported, not invented
 *
 * Expected results on the Create Project sheet were observed against the live
 * application on 2026-08-10, not invented.
 *
 * Run: npm run excel:demo [-- --out <path>]
 */

import path from 'node:path';

import { Workbook, type Worksheet } from 'exceljs';

const HEADERS = [
  'TC ID', 'Module', 'Feature', 'Test Scenario', 'Test Case Description', 'Pre-Requisite',
  'Test Steps', 'Test Data', 'Expected', 'Prio', 'Tags', 'Automation', 'Automation Notes', 'Run',
];

type Row = string[];

const LOGIN_ROWS: Row[] = [
  [
    'TC_LOGIN_001', 'Login', 'Authentication', 'Valid Login',
    'Verify a registered user can sign in with correct credentials.',
    'User account exists and is active',
    'Open the Bugasura login page\nEnter a registered email\nEnter the correct password\nClick Sign In',
    'BUGASURA_EMAIL / BUGASURA_PASSWORD',
    'User is signed in and the workspace dashboard is displayed',
    'P0', 'smoke, regression', 'Not Automated', '', 'Yes',
  ],
  [
    'TC_LOGIN_002', 'Login', 'Authentication', 'Invalid Password',
    'Verify sign in is rejected when the password is wrong.',
    'User account exists and is active',
    'Open the Bugasura login page\nEnter a registered email\nEnter an incorrect password\nClick Sign In',
    'BUGASURA_EMAIL / wrong password',
    'An error message is displayed and the user stays on the login page',
    'P0', 'smoke, negative', 'Not Automated', '', 'Yes',
  ],
  [
    'TC_LOGIN_003', 'Login', 'Validation', 'Empty Email Validation',
    'Verify the form blocks submission when the email is blank.',
    '',
    'Open the Bugasura login page\nLeave the email field empty\nEnter any password\nClick Sign In',
    'blank email',
    'A validation message is shown for the email field and no navigation occurs',
    'P0', 'negative', 'Not Automated', '', 'Yes',
  ],
  [
    'TC_LOGIN_004', 'Login', 'Password Recovery', 'Forgot Password Link',
    'Verify the forgot password link opens the recovery form.',
    '',
    'Open the Bugasura login page\nClick the Forgot Password link',
    '',
    'The password recovery form is displayed',
    'P1', 'regression', 'Not Automated', '', 'Yes',
  ],
  [
    // Deliberately poor: no expected result, vague wording, no data.
    'TC_LOGIN_005', 'Login', 'Authentication', 'Login should work properly',
    'Check that login works fine for various users.',
    '',
    'Login with valid data and verify it works correctly etc',
    '',
    '',
    'P0', 'smoke', 'Not Automated', 'Author to clarify', 'Yes',
  ],
  [
    // Near-duplicate of TC_LOGIN_001, different ID.
    'TC_LOGIN_006', 'Login', 'Authentication', 'Valid Login',
    'Verify a registered user can sign in with correct credentials.',
    'User account exists and is active',
    'Open the Bugasura login page\nEnter a registered email\nEnter the correct password\nClick Sign In',
    'BUGASURA_EMAIL / BUGASURA_PASSWORD',
    'User is signed in and the workspace dashboard is displayed',
    'P1', 'regression', 'Not Automated', '', 'Yes',
  ],
  [
    'TC_LOGIN_007', 'Login', 'Boundary', 'Email Field Maximum Length',
    'Verify the email field enforces its maximum length.',
    '',
    'Open the Bugasura login page\nEnter an email of 255 characters\nClick Sign In',
    '255-character email address',
    'The field accepts at most 255 characters and a validation error is displayed',
    'P2', 'boundary, negative', 'Not Automated',
    'Workbook says 255; the application enforces 250 - see ai/reports/test-case-change-requests.md',
    'Yes',
  ],
];

const SIGNED_IN = 'User is signed in to Bugasura and on the Projects page (/apps)';

const PROJECT_ROWS: Row[] = [
  [
    'TC_PROJ_001', 'Projects', 'Create Project', 'Create a project with a valid name and team',
    'Verify a signed-in user can create a new project by supplying a name and selecting a team.',
    SIGNED_IN,
    'Click + Create Project\nEnter a unique project name\nSelect a team\nClick Create Project',
    'name: unique project name; team: a team the user belongs to',
    'The project is created and appears in the project list',
    'P1', 'regression, smoke', 'Not Automated',
    'Writes to the live workspace - keep Run=No unless a disposable team is available', 'No',
  ],
  [
    'TC_PROJ_002', 'Projects', 'Create Project', 'Create Project form opens from the Projects page',
    'Verify the + Create Project control opens the form with Project Name and Team fields.',
    SIGNED_IN,
    'Click + Create Project',
    '',
    'The create form is displayed with a Project Name field and a mandatory Team selector',
    'P2', 'regression', 'Not Automated', '', 'Yes',
  ],
  [
    'TC_PROJ_003', 'Projects', 'Validation', 'Team is mandatory',
    'Verify a project cannot be created without selecting a team.',
    SIGNED_IN,
    'Click + Create Project\nEnter a valid project name\nLeave Team unselected\nClick Create Project',
    'name: any valid name; team: none selected',
    'The error "Team is not selected." is displayed, the form stays open and no project is created',
    'P1', 'negative, regression', 'Not Automated', '', 'Yes',
  ],
  [
    'TC_PROJ_004', 'Projects', 'Validation', 'Project name is mandatory',
    'Verify a project cannot be created with an empty name.',
    SIGNED_IN,
    'Click + Create Project\nLeave Project Name empty\nSelect a team\nClick Create Project',
    'name: empty; team: any team',
    'The error "Project name cannot be empty." is displayed, the form stays open and no project is created',
    'P1', 'negative, regression', 'Not Automated',
    'A team must be selected first, otherwise the team error masks this one', 'Yes',
  ],
  [
    'TC_PROJ_005', 'Projects', 'Validation', 'Whitespace-only project name is rejected',
    'Verify a name made only of spaces is treated as empty rather than accepted.',
    SIGNED_IN,
    'Click + Create Project\nEnter three spaces as the project name\nSelect a team\nClick Create Project',
    'name: "   " (three spaces); team: any team',
    'The name is rejected as empty and no project is created',
    'P2', 'negative, boundary', 'Not Automated',
    'If the app does NOT trim, this creates a junk project - treated as data-mutating until proven otherwise',
    'No',
  ],
  [
    'TC_PROJ_006', 'Projects', 'Create Project', 'Cancel discards the form',
    'Verify Cancel closes the create form without creating a project.',
    SIGNED_IN,
    'Click + Create Project\nEnter a project name\nClick Cancel',
    'name: any valid name',
    'The form closes and no project is created',
    'P2', 'regression', 'Not Automated', '', 'Yes',
  ],
  [
    'TC_PROJ_007', 'Projects', 'Boundary', 'Project name field length limit',
    'Verify what limit, if any, the Project Name field enforces on input.',
    SIGNED_IN,
    'Click + Create Project\nType 300 characters into Project Name\nInspect the field value without submitting',
    'name: 300 characters',
    'The field enforces a documented maximum length',
    'P3', 'boundary', 'Not Automated',
    'Currently fails: the field declares no maxlength and accepts 300 characters', 'Yes',
  ],
  [
    'TC_PROJ_008', 'Projects', 'Validation', 'Duplicate project name is rejected',
    'Verify a second project cannot be created with the name of an existing project.',
    `${SIGNED_IN}; at least one project already exists`,
    'Click + Create Project\nEnter the name of an existing project\nSelect the same team\nClick Create Project',
    'name: name of an existing project; team: that project\'s team',
    'The duplicate is rejected with an error and no second project is created',
    'P2', 'negative', 'Not Automated',
    'Attempts a create - keep Run=No until a disposable team is available', 'No',
  ],
  [
    // Malformed on purpose: no Test Case ID at all. Must be reported, not invented.
    '', 'Projects', 'Project Management', 'Delete Project',
    'Verify a project can be deleted.', SIGNED_IN,
    'Open Projects\nSelect a project\nClick Delete\nConfirm',
    '', 'The project is removed from the list', 'P2', '', 'Not Automated', '', 'No',
  ],
];

const WIDTHS = [15, 11, 19, 40, 50, 38, 50, 40, 58, 7, 21, 15, 44, 7];

/**
 * The data-driven sheet: rows that execute with no spec written for them.
 *
 * Its columns differ from the sheets above on purpose - `Assert Outcome` and
 * `Assert Message` are parsed by the runner rather than read by a person, and
 * the mapper has to handle a sheet whose shape is nothing like its neighbours'.
 */
const VALIDATION_HEADERS = [
  'Test Case ID', 'Module', 'Feature', 'Scenario', 'Steps', 'Test Data', 'Expected Result',
  'Assert Outcome', 'Assert Message', 'Priority', 'Tags', 'Run',
];

const VALIDATION_WIDTHS = [16, 12, 16, 40, 46, 34, 46, 16, 40, 9, 18, 7];

// Deliberately does not say "enter the test data": the quality analyzer flags
// "test data" as vague wording, and rightly so in most workbooks. Naming the
// fields is clearer for a human reader anyway.
const VALIDATION_STEPS =
  'Open the Bugasura login page\nEnter the email address for this case\n' +
  'Enter the password for this case\nClick Sign In';

const VALIDATION_ROWS: Row[] = [
  [
    'TC_LOGIN_010', 'Login', 'Validation', 'Sign in with an empty email is refused',
    VALIDATION_STEPS, 'email = <blank>\npassword = <invalid-password>',
    'The form refuses the submission, no request is sent and the user stays on the sign-in page',
    'Blocked', '', 'P1', 'negative,validation', 'Yes',
  ],
  [
    'TC_LOGIN_011', 'Login', 'Validation', 'Sign in with an empty password is refused',
    VALIDATION_STEPS, 'email = <registered-email>\npassword = <blank>',
    'The form refuses the submission and the user stays on the sign-in page',
    'Blocked', '', 'P1', 'negative,validation', 'Yes',
  ],
  [
    'TC_LOGIN_012', 'Login', 'Validation', 'Sign in with both fields empty is refused',
    VALIDATION_STEPS, 'email = <blank>\npassword = <blank>',
    'The form refuses the submission and the user stays on the sign-in page',
    'Blocked', '', 'P2', 'negative,validation', 'Yes',
  ],
  [
    'TC_LOGIN_013', 'Login', 'Validation', 'Sign in with a malformed email is refused',
    VALIDATION_STEPS, 'email = not-an-email\npassword = <invalid-password>',
    'The email field rejects a value that is not an address and the submission does not proceed',
    'Blocked', '', 'P1', 'negative,validation', 'Yes',
  ],
  [
    'TC_LOGIN_014', 'Login', 'Validation', 'Sign in with an unregistered email is rejected',
    VALIDATION_STEPS, 'email = no.such.user.98213@example.com\npassword = <invalid-password>',
    'Bugasura reports that the account does not exist and the user stays on the sign-in page',
    'Error', '/does not exist/i', 'P1', 'negative', 'Yes',
  ],
  [
    'TC_LOGIN_015', 'Login', 'Validation', 'Sign in with the wrong password is rejected',
    VALIDATION_STEPS, 'email = <registered-email>\npassword = <invalid-password>',
    'An error message is displayed and the user stays on the sign-in page',
    'Error', '', 'P0', 'negative', 'Yes',
  ],
  [
    'TC_LOGIN_016', 'Login', 'Boundary', 'Sign in with an email over the length limit is rejected',
    VALIDATION_STEPS, 'email = <email:251>\npassword = <invalid-password>',
    'An email longer than 250 characters is rejected with a message naming the limit',
    'Error', '/cannot be longer than 250 characters/i', 'P2', 'boundary,negative', 'Yes',
  ],
];

function addCaseSheet(workbook: Workbook, name: string, rows: Row[], banner?: string): Worksheet {
  const sheet = workbook.addWorksheet(name);

  if (banner) {
    sheet.addRow([banner]);
    sheet.getRow(1).font = { bold: true, size: 13 };
    sheet.addRow([]);
  }

  const headerRow = sheet.addRow(HEADERS);
  headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: banner ? 'FF375623' : 'FF1F3864' } };

  for (const row of rows)
    sheet.addRow(row).alignment = { vertical: 'top', wrapText: true };

  WIDTHS.forEach((width, index) => { sheet.getColumn(index + 1).width = width; });
  sheet.views = [{ state: 'frozen', ySplit: headerRow.number }];
  sheet.autoFilter = {
    from: { row: headerRow.number, column: 1 },
    to: { row: headerRow.number, column: HEADERS.length },
  };
  return sheet;
}

function addValidationSheet(workbook: Workbook): Worksheet {
  const sheet = workbook.addWorksheet('Login Validation');
  const headerRow = sheet.addRow(VALIDATION_HEADERS);
  headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF7030A0' } };
  headerRow.alignment = { vertical: 'middle', wrapText: true };
  headerRow.height = 30;

  for (const row of VALIDATION_ROWS)
    sheet.addRow(row).alignment = { vertical: 'top', wrapText: true };

  VALIDATION_WIDTHS.forEach((width, index) => { sheet.getColumn(index + 1).width = width; });
  sheet.views = [{ state: 'frozen', ySplit: 1 }];
  sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: VALIDATION_HEADERS.length } };
  return sheet;
}

async function main(): Promise<void> {
  const workbook = new Workbook();
  workbook.creator = 'Moolya QA';

  const readme = workbook.addWorksheet('Read Me');
  readme.getColumn(1).width = 104;
  readme.addRow(['Bugasura - test case pack']).font = { bold: true, size: 14 };
  readme.addRow([]);
  readme.addRow(['This sheet is prose, not a test case table. The parser must skip it.']);
  readme.addRow(['Owner: QA Chapter. Target application: https://my.bugasura.io/']);
  readme.addRow([]);
  readme.addRow(['Sheets: "Login Test Cases", "Create Project" and "Login Validation".']);
  readme.addRow([]);
  readme.addRow(['Run column: Yes = include in the next run. Cases that write to the live']);
  readme.addRow(['workspace are set to No, because nothing deletes what they create. Set']);
  readme.addRow(['BUGASURA_ALLOW_DATA_MUTATION=1 and BUGASURA_TEAM=<team> before enabling them.']);
  readme.addRow([]);
  readme.addRow(['"Login Validation" is data-driven: those rows run with no automation code']).font = { bold: true };
  readme.addRow(['written for them. To add a case, copy a row and change three cells:']);
  readme.addRow(['  Test Data       one "name = value" per line, e.g. email = <blank>']);
  readme.addRow(['  Assert Outcome  Signed In | Error | Blocked']);
  readme.addRow(['  Assert Message  what the rejection must say - only with Error; /regex/ allowed']);
  readme.addRow([]);
  readme.addRow(['Never type a password into this file. Name it instead:']);
  readme.addRow(['  <blank>  <registered-email>  <valid-password>  <invalid-password>']);
  readme.addRow(['  <email:250>  <chars:300>      resolved from .env when the test runs']);
  readme.addRow([]);
  readme.addRow(['Leave Assert Outcome empty and the row is NOT data-driven - it waits for a']);
  readme.addRow(['hand-written test. Fill it in wrongly and the run fails loudly, naming this']);
  readme.addRow(['sheet and row; it is never skipped silently.']);

  addCaseSheet(workbook, 'Login Test Cases', LOGIN_ROWS,
      'Bugasura - Login test cases (v4, owned by QA Chapter)');
  addCaseSheet(workbook, 'Create Project', PROJECT_ROWS);
  addValidationSheet(workbook);

  // `--out <path>` writes elsewhere, handy when the usual workbook is open in
  // Excel and therefore locked.
  const outFlag = process.argv.indexOf('--out');
  const outputPath = outFlag !== -1 && process.argv[outFlag + 1]
    ? path.resolve(process.argv[outFlag + 1])
    : path.resolve(process.cwd(), 'excel', 'login-test-cases.xlsx');

  await workbook.xlsx.writeFile(outputPath);
  const total = LOGIN_ROWS.length + PROJECT_ROWS.length + VALIDATION_ROWS.length;
  process.stdout.write(`demo workbook written: ${path.relative(process.cwd(), outputPath).replace(/\\/g, '/')}\n`);
  process.stdout.write(`  4 worksheets, ${total} data rows (${LOGIN_ROWS.length} login, ` +
    `${PROJECT_ROWS.length} project, ${VALIDATION_ROWS.length} data-driven), 1 deliberately malformed\n`);
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exit(1);
});
