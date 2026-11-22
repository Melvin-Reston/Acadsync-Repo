# AcadSync — Admin Parts 1 and 2, Teacher Batches 1–8

One project with two folders:

- `backend/` is the API (Node.js, Express, PostgreSQL)
- `frontend/` is the admin console and the teacher portal (Angular)

Part 1 contains: admin sign-in (Super User and Admin), overview, teachers, schools, activity log and settings.

Part 2 adds: plans & packages, subscriptions per teacher, payments & invoices, reports, announcements, the payment QR code in settings, and the subscription, income and waiting-payment cards on the overview.

Teacher Batch 1 adds the teacher side: teacher sign-up (Create Account with Choose Plan), teacher sign-in, the Teacher Dashboard and the teacher Profile page. See [The teacher side](#the-teacher-side).

Teacher Batch 4.1 adds the grading-system switch: the grading system is chosen per academic year in Settings (DO 8 s. 2015, DO 015 s. 2026 adjusted for SY 2026–2027, or DO 015 zero-based from SY 2027–2028), with three terms instead of four quarters under DO 015, Examinations columns with sub-weights, subject groups for the default weights, and final grades in Consolidation. See [Grading systems](#grading-systems) and [Upgrading from Teacher Batch 4](#upgrading-from-teacher-batch-4).

Teacher Batch 6 adds Payments & Invoices for the teacher: the current plan with days left, the active plans with prices, the teacher's own invoices, and the receipt for one invoice — paid by scanning the administrator's QR code, with a screenshot and a reference number sent for confirmation. See [Payments & Invoices](#payments--invoices) and [Upgrading from Teacher Batch 5](#upgrading-from-teacher-batch-5).

Teacher Batch 8 adds the DepEd print forms: the Class Record and Final Grades printouts on the Grades page, the School Form 2 (SF2) daily attendance report on the Attendance page, and the Region, Division and School ID the teacher enters on the Profile page, which print on the forms. See [Teacher Batch 8: DepEd print forms](#teacher-batch-8-deped-print-forms) and [Upgrading from Teacher Batch 7 fix 2](#upgrading-from-teacher-batch-7-fix-2).

Already running Part 1? Go straight to [Upgrading from Part 1](#upgrading-from-part-1).

Already running admin Parts 1 and 2? Go straight to [Upgrading from Admin Part 2](#upgrading-from-admin-part-2).

## Four rules that prevent most problems

1. **Every backend command runs inside the `backend` folder.** Run `cd backend` first. `npm install`, `npm run migrate`, `npm run seed`, `npm run dev` and `npm test` do not work from the `acadsync` folder.
2. **The settings file is named exactly `.env`** (not `.env.txt`, not `env`) and sits inside `backend`. **Save it** (Ctrl+S) after every change, then restart the backend.
3. **A `.env` value that contains `#` must be wrapped in double quotes**, like `ADMIN_PASSWORD="Pass#word123"`. Without the quotes everything from the `#` onward is ignored.
4. **Type commands exactly as written.** They work in Git Bash, PowerShell and Command Prompt.

## What you need

| Tool | Version |
| --- | --- |
| Node.js | 24.15 or newer (24 LTS). 22.22.3 or newer also works |
| PostgreSQL | 15 or newer (built and tested on 18) |
| VS Code | any recent version |

The Angular frontend asks for Node.js **24.15 or newer**. Check with `node -v`. If it prints an older 24 version such as `v24.14.0`, install the current **LTS** from https://nodejs.org over it, then close and reopen VS Code.

Using a hosted database such as Neon? You do not need to install PostgreSQL. See [Using Neon instead of local PostgreSQL](#using-neon-instead-of-local-postgresql).

## Setup on Windows, step by step

### 1. Install Node.js

Download the **LTS** installer from https://nodejs.org and install it with the default options.
Open a new terminal in VS Code (**Terminal > New Terminal**) and check:

```
node -v
npm -v
```

Both should print a version number.

### 2. Install PostgreSQL

Download the Windows installer from https://www.postgresql.org/download/windows/ and install it with the default options.

- The installer asks for a password for the `postgres` user. Write it down. You need it in step 5.
- Keep the port as `5432`.
- pgAdmin is installed together with PostgreSQL.

### 3. Create the database

1. Open **pgAdmin** and connect with the `postgres` password.
2. Right-click **Databases > Create > Database...**
3. Name it `acadsync` and click **Save**.

You do not need to create any tables. Step 7 does that.

### 4. Open the project

Unzip the project, then in VS Code choose **File > Open Folder...** and pick the `acadsync` folder (the one that contains `backend` and `frontend`).

### 5. Create the backend `.env` file

In the `backend` folder, copy `.env.example` and name the copy `.env`. In a terminal:

```
cd backend
cp .env.example .env
```

(In Command Prompt use `copy .env.example .env` instead.)

Open `backend/.env` and fill in:

| Setting | What to put |
| --- | --- |
| `DB_PASSWORD` | the `postgres` password from step 2 |
| `JWT_SECRET` | a long random text. Run the command below and paste the result |
| `SUPER_USER_NAME`, `SUPER_USER_EMAIL`, `SUPER_USER_PASSWORD` | your Super User account |
| `ADMIN_NAME`, `ADMIN_EMAIL`, `ADMIN_PASSWORD` | your Admin account |

To generate a `JWT_SECRET`:

```
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

Rules for the two accounts:

- The two emails must be different.
- Each password needs at least 8 characters, with at least one letter and one number.
- Use a real email for the Super User. Password reset links are sent to it.

If a password or any other value contains `#`, wrap the value in double quotes: `ADMIN_PASSWORD="Pass#word123"`.

Leave everything else as it is. Save the file. Never share your `.env` file.

### 6. Install the backend packages

Still inside the `backend` folder:

```
npm install
```

### 7. Create the tables

```
npm run migrate
```

You should see `Applied 001_init.sql`, `Applied 002_billing.sql` and `Applied 003_teacher_portal.sql`.
The second file also adds the two plans, **Teacher Free** and **Teacher Pro**. The third file adds the teacher sign-in and password-reset tables and the advisory fields on teachers.

### 8. Create the Super User and Admin accounts

```
npm run seed
```

You should see `Created Super User: ...` and `Created Admin: ...`.
The passwords are stored as one-way hashes, never as readable text. After this step you can remove the two passwords from `.env` if you like.

### 9. Start the backend

```
npm run dev
```

You should see `AcadSync API is running at http://localhost:3000/api`. Leave this terminal open.

### 10. Install and start the frontend

Open a **second** terminal (**Terminal > New Terminal**):

```
cd frontend
npm install
npm start
```

Wait for `Local: http://localhost:4200/`. Leave this terminal open too.

### 11. Open the admin console and sign in

Open http://localhost:4200 in your browser.
Sign in with the Super User or Admin email and password you chose in step 5.

Start by adding a school (**Schools > Add school**), then add a teacher (**Teachers > Add teacher**).

## Using Neon instead of local PostgreSQL

Skip steps 2 and 3 (no PostgreSQL install, no database to create). In step 5, set these two lines in `backend/.env` and leave the `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER` and `DB_PASSWORD` lines as they are (they are ignored when `DATABASE_URL` is set):

```
DATABASE_URL="paste the connection string from the Neon dashboard here"
DB_SSL=true
```

- Keep the double quotes around the connection string.
- Then continue with steps 6 to 11 as written.
- A yellow **SSL security warning** from the `pg` library can appear when a command connects. It is harmless. The connection is encrypted.
- Skip `npm test` unless you also have a local PostgreSQL or you set `TEST_DATABASE_URL` to a **separate, empty** database. The tests wipe the database they use, and they refuse to start if it is the same as your real one.
- Treat the connection string like a password. If it was ever shared, reset the password in the Neon dashboard and paste the new string into `.env`.

## Upgrading from Part 1

Your `.env` file and everything in your database are kept. You do not run the seed again.

1. Stop the backend and the frontend (press Ctrl+C in both terminals).
2. Unzip the Part 2 zip **over your existing `acadsync` folder** and choose **Replace** when Windows asks. Your `backend/.env` is not in the zip, so it stays as it is.
3. In the first terminal:

```
cd backend
npm install
npm run migrate
npm run dev
```

`npm run migrate` should print `Applied 002_billing.sql`. It adds the new tables and the two plans and does not touch your existing teachers, schools or accounts.

4. In the second terminal:

```
cd frontend
npm install
npm start
```

5. Open http://localhost:4200 and sign in as before. The sidebar now has **Subscriptions**, **Payments & Invoices**, **Plans & Packages**, **Reports** and **Announcements**.

No new `.env` settings are required. Three optional ones exist (`APP_TIMEZONE`, `INVOICE_DUE_DAYS`, `UPLOAD_DIR`). They are described at the bottom of `backend/.env.example`.

## Upgrading from Teacher Batch 1

Your `.env` file and everything in your database are kept. You do not run the seed again, and there is no new database migration — `npm run migrate` will simply say the database is already up to date.

1. Stop the backend and the frontend (press Ctrl+C in both terminals).
2. Unzip the restyle zip **over your existing `acadsync` folder** and choose **Replace** when Windows asks. Your `backend/.env` is not in the zip, so it stays as it is.
3. In the first terminal:

```
cd backend
npm install
npm run migrate
npm run dev
```

4. In the second terminal:

```
cd frontend
npm install
npm start
```

5. Open http://localhost:4200 and sign in as before. The teacher sign-in, Create Account, forgot-password and reset pages now use the earlier teacher-login arrangement (top bar, brand panel with the today-classes card and features, "Welcome back" heading) in the warm paper theme. The admin sign-in keeps its simple panel.

No new `.env` settings are required.

## Upgrading from Teacher Batch 1 (restyle)

Your `.env` file and everything in your database are kept. You do not run the seed again.

1. Stop the backend and the frontend (press Ctrl+C in both terminals).
2. Unzip the Teacher Batch 2 zip **over your existing `acadsync` folder** and choose **Replace** when Windows asks. Your `backend/.env` is not in the zip, so it stays as it is.
3. In the first terminal:

```
cd backend
npm install
npm run migrate
npm run dev
```

`npm run migrate` should print `Applied 004_classes.sql`. It adds the subjects, classes, learners, enrolments and class-meetings tables and does not touch your existing teachers, schools, subscriptions, invoices or accounts. Your teachers start with no subjects, classes or learners — each teacher adds their own.

4. In the second terminal:

```
cd frontend
npm install
npm start
```

5. Open http://localhost:4200 and sign in as before. Teachers now have **Classes & Sections** and **Schedules** in the sidebar (see [Classes & Sections and Schedules](#classes--sections-and-schedules)). The Dashboard shows the teacher's classes today, and the sign-in panel shows them too once the teacher is signed in.

No new `.env` settings are required.

## Upgrading from Teacher Batch 2

Your `.env` file and everything in your database are kept. You do not run the seed again.

1. Stop the backend and the frontend (press Ctrl+C in both terminals).
2. Unzip the Teacher Batch 3 zip **over your existing `acadsync` folder** and choose **Replace** when Windows asks. Your `backend/.env` is not in the zip, so it stays as it is.
3. In the first terminal:

```
cd backend
npm install
npm run migrate
npm run dev
```

`npm run migrate` should print `Applied 005_attendance.sql`. It adds the attendance table and does not touch your existing teachers, schools, subscriptions, invoices, classes, learners or accounts. Attendance starts empty for every class and date — nothing is pre-filled.

4. In the second terminal:

```
cd frontend
npm install
npm start
```

5. Open http://localhost:4200 and sign in as before. Teachers now have **Attendance** in the sidebar (see [Attendance](#attendance)). The first time you open it, add learners to a class and print their QR pass cards from **Classes & Sections > Learners**.

No new `.env` settings are required.

## Upgrading from Teacher Batch 3

Your `.env` file and everything in your database are kept. You do not run the seed again.

1. Stop the backend and the frontend (press Ctrl+C in both terminals).
2. Unzip the Teacher Batch 4 zip **over your existing `acadsync` folder** and choose **Replace** when Windows asks. Your `backend/.env` is not in the zip, so it stays as it is.
3. In the first terminal:

```
cd backend
npm install
npm run migrate
npm run dev
```

`npm run migrate` should print `Applied 006_grades.sql`. It adds the grade columns, scores, weights, submissions and reminders tables and does not touch your existing teachers, schools, subscriptions, invoices, classes, learners, meetings or attendance. Every grade sheet starts empty — no grades are invented.

4. In the second terminal:

```
cd frontend
npm install
npm start
```

5. Open http://localhost:4200 and sign in as before. Teachers now have **Grades** and **Consolidation** in the sidebar (see [Grades and Academic Consolidation](#grades-and-academic-consolidation)). **Payments & Invoices** is added in Teacher Batch 6.

No new `.env` settings are required.

## Upgrading from Teacher Batch 4

Your `.env` file and everything in your database are kept. You do not run the seed again.

1. Stop the backend and the frontend (press Ctrl+C in both terminals).
2. Unzip the Teacher Batch 4.1 zip **over your existing `acadsync` folder** and choose **Replace** when Windows asks. Your `backend/.env` is not in the zip, so it stays as it is.
3. In the first terminal:

```
cd backend
npm install
npm run migrate
npm run dev
```

`npm run migrate` should print `Applied 007_grading_profiles.sql`. It adds one table (`grading_profiles`, one grading system per academic year, starting on DO 015 adjusted for your current year), converts the old Quarterly Assessment columns to Examinations columns, renames the third weight to the Examinations weight, and records that everything filed so far was filed under DO 8. It does not touch your existing teachers, schools, subscriptions, invoices, classes, learners, meetings, attendance or scores.

4. In the second terminal:

```
cd frontend
npm install
npm start
```

5. Open http://localhost:4200 and sign in as before. The Grades page now shows Terms 1–3 and Examinations columns (Summative Test 1, Summative Test 2, Term Exam), and Consolidation has a **Final grades** section (see [Grading systems](#grading-systems)).

No new `.env` settings are required.

## Upgrading from Teacher Batch 4.1

Your `.env` file and everything in your database are kept. You do not run the seed again.

1. Stop the backend and the frontend (press Ctrl+C in both terminals).
2. Unzip the Teacher Batch 5 zip **over your existing `acadsync` folder** and choose **Replace** when Windows asks. Your `backend/.env` is not in the zip, so it stays as it is.
3. In the first terminal:

```
cd backend
npm install
npm run migrate
npm run dev
```

`npm run migrate` should print `Applied 008_report_card.sql`. It adds one table (`report_card_comments`, one saved comment per learner per term or quarter) and does not touch your existing teachers, schools, subscriptions, invoices, classes, learners, meetings, attendance, scores or submissions.

4. In the second terminal:

```
cd frontend
npm install
npm start
```

5. Open http://localhost:4200 and sign in as before. **Report Card** now appears in the teacher sidebar after Consolidation (see [Report Card](#report-card)).

No new `.env` settings are required.

## Upgrading from Teacher Batch 5

Your `.env` file and everything in your database are kept. You do not run the seed again.

1. Stop the backend and the frontend (press Ctrl+C in both terminals).
2. Unzip the Teacher Batch 6 zip **over your existing `acadsync` folder** and choose **Replace** when Windows asks. Your `backend/.env` is not in the zip, so it stays as it is.
3. In the first terminal:

```
cd backend
npm install
npm run migrate
npm run dev
```

`npm run migrate` should print `Database is already up to date`. Batch 6 needs no database change: plans, subscriptions, invoices and payments already exist from Part 2, so nothing is added and nothing is touched.

4. In the second terminal:

```
cd frontend
npm install
npm start
```

5. Open http://localhost:4200 and sign in as before. **Payments & Invoices** now appears in the teacher sidebar under Account (see [Payments & Invoices](#payments--invoices)), and the Dashboard plan card links to it.

No new `.env` settings are required.

## Upgrading from Teacher Batch 7 fix 2

Your `.env` file and everything in your database are kept. You do not run the seed again.

1. Stop the backend and the frontend (press Ctrl+C in both terminals).
2. Unzip the Teacher Batch 8 zip **over your existing `acadsync` folder** and choose **Replace** when Windows asks. Your `backend/.env` is not in the zip, so it stays as it is.
3. In the first terminal:

```
cd backend
npm install
npm run migrate
npm run dev
```

`npm run migrate` should print `Applied 010_teacher_school_details.sql`. It adds three optional fields (Region, Division, School ID) to the teacher's own record, for the DepEd print forms. Nothing else changes.

4. In the second terminal:

```
cd frontend
npm install
npm start
```

5. Open http://localhost:4200 and sign in as before. Nothing is lost; the new printouts are listed under [Teacher Batch 8: DepEd print forms](#teacher-batch-8-deped-print-forms).

No new `.env` settings are required.

## Teacher Batch 8: DepEd print forms

1. **School details for DepEd forms** — on the **Profile** page, under Personal details, three optional fields: **Region**, **Division** and **School ID**. They print on the DepEd forms below, and stay blank on the forms when unset. Nothing else on the profile changes, and the teaching assignment stays read-only.
2. **Class Record print** — on the **Grades** page, **Print class record** prints the current sheet in the DepEd Class Record format: the seal and DepEd logo, Region / Division / School ID / School Name / School Year, Grade Level / Section / Teacher / Subject, the Highest Possible Score row, then Written Works, Performance Tasks and Examinations (with the ST1 / ST2 / Term Exam sub-columns and their weighted scores under DO 015, or the single Quarterly Assessment block under DO 8), then Initial Grade, Term/Quarter Grade and Descriptor. Learners are grouped Male then Female, numbered separately. The printout shows the sheet as it is right now, including blanks — it is the working record. It prints landscape, in black and white.
3. **Final Grades tab** — next to the term tabs on the **Grades** page. It shows every filed term side by side with the Final Grade, Descriptor and Remark (Passed at 75 or above, Failed below it, blank when there is no final grade yet). The data follows the same rule as the Final column: filed submissions only, and the final grade appears only once every term is filed. **Print final grades** prints it in the DepEd Class Record – Final Grades format, with the same header and Male/Female grouping.
4. **SF2 tab** — on the **Attendance** page, next to Daily roll. Pick a month (June to April of the school year) to preview the **School Form 2 Daily Attendance Report of Learners**: Monday–Friday days only, names in alphabetical order, X for Absent, L for Late, E for Excused, blank for Present or no record, with Absent and Present totals that cover recorded school days only. **Print SF2** prints the form, landscape, in black and white, with no logos. The Remarks column stays blank for handwriting.

## Upgrading from Teacher Batch 6

Your `.env` file and everything in your database are kept. You do not run the seed again.

1. Stop the backend and the frontend (press Ctrl+C in both terminals).
2. Unzip the Teacher Batch 7 zip **over your existing `acadsync` folder** and choose **Replace** when Windows asks. Your `backend/.env` is not in the zip, so it stays as it is.
3. In the first terminal:

```
cd backend
npm install
npm run migrate
npm run dev
```

`npm run migrate` should print `Applied 009_learners_school.sql`. It adds the school and birthdate to learners and makes the learner ID unique per school instead of per teacher. If two teachers in your school already created the same learner ID, the migration keeps the earliest learner and moves that learner's enrolments, attendance and grades onto it — nothing is lost.

4. In the second terminal:

```
cd frontend
npm install
npm start
```

5. Open http://localhost:4200 and sign in as before. Classes & Sections, Grades and Attendance look different (see [Teacher Batch 7](#teacher-batch-7-enhancements-round-1)), but everything you had is still there.

No new `.env` settings are required.

## Upgrading from Teacher Batch 7 fix 1

Your `.env` file and everything in your database are kept. You do not run the seed again.

1. Stop the backend and the frontend (press Ctrl+C in both terminals).
2. Unzip the Teacher Batch 7 fix 2 zip **over your existing `acadsync` folder** and choose **Replace** when Windows asks. Your `backend/.env` is not in the zip, so it stays as it is.
3. In the first terminal:

```
cd backend
npm install
npm run migrate
npm run dev
```

`npm run migrate` should print `Database is already up to date`. Fix 2 needs no new migration.

4. In the second terminal:

```
cd frontend
npm install
npm start
```

5. Open http://localhost:4200 and sign in as before. Nothing is lost; the change is listed under [Teacher Batch 7 fix 2](#teacher-batch-7-fix-2).

No new `.env` settings are required.

## Teacher Batch 7 fix 2

One addition on top of fix 1: the Grades page now has a **Final** column at the right end of the encoding table, after the term grade. It shows the mean of the filed term grades for the class, rounded — and only once every term is filed; until then it shows —. It is computed from filed submissions only, so editing a score after filing clears the filing and the final disappears until the term is filed again. Any subject teacher sees the finals for their own classes; no advisory assignment is needed. The same Final grade shows on the per-learner cards on phones. Nothing about how grades are computed changes, and the general average stays in Consolidation.

## Upgrading from Teacher Batch 7

Your `.env` file and everything in your database are kept. You do not run the seed again.

1. Stop the backend and the frontend (press Ctrl+C in both terminals).
2. Unzip the Teacher Batch 7 fix 1 zip **over your existing `acadsync` folder** and choose **Replace** when Windows asks. Your `backend/.env` is not in the zip, so it stays as it is.
3. In the first terminal:

```
cd backend
npm install
npm run migrate
npm run dev
```

`npm run migrate` should print `Database is already up to date`. Fix 1 needs no new migration.

4. In the second terminal:

```
cd frontend
npm install
npm start
```

5. Open http://localhost:4200 and sign in as before. Nothing is lost; the three changes are listed under [Teacher Batch 7 fix 1](#teacher-batch-7-fix-1).

No new `.env` settings are required.

## Teacher Batch 7 fix 1

Three small fixes on top of Batch 7. Nothing about your data changes.

1. **Enrol learners modal** — the modal no longer lists the learners already enrolled in the class, so it stays short even for a class of 50. It only enrols: pick a learner from the dropdown and press Enrol, or quick-add a new learner. The roster lives only on the **Learners tab**, and removing a learner from a class moved there too: on a class roster, open the learner's 3-dots menu and choose **Remove from class**. The menu only offers it on a class roster, never in the whole-directory view.
2. **Manage Class Schedules modal** — the modal no longer lists every meeting above the form. It only adds or edits a meeting (including **Repeat for the whole week**). Edit and Delete moved onto the **Daily Agenda** tab: each agenda row has Edit and Delete buttons, and Delete still asks for confirmation first. The Weekly Timetable Grid blocks stay display-only.
3. **Dropdown panels** — a dropdown panel can no longer run past the right edge of the screen (this showed on the Consolidation Term dropdown). When a panel would overflow, it anchors to the right edge of its field instead, and it can never be wider than the screen. This is fixed in the shared dropdown, so it holds on every page, in light and dark mode, on desktop and phone.

## Teacher Batch 7: Enhancements round 1

Batch 7 restyles Classes & Sections, View Sections and Grades to the earlier neat and clean designs, with small corners (4–8px) on cards, buttons, inputs, dropdowns, menus and modals, and the same warm paper / burnt-orange system. Nothing about how grades are computed changes.

### What changed

1. **Classes & Sections** — big serif heading, class overview, Tiles/List toggle, search, grade filter, class tiles with sections and students counts, View sections, Delete. Every function works as before.
2. **View Sections** — section cards with grade level, room and schedule, Hide sections, Delete.
3. **Learners** — a learner now has a **birthdate** (optional) and a **School** (from the database), shown as columns. The learner table has a 3-dots action column: **QR Card** (opens the learner QR pass card), **Edit** (name, learner ID, sex, birthdate), **Delete**. Delete is refused with a plain message when the learner is enrolled in a class or has attendance or grade records; only a learner with no records can be deleted.
4. **Shared school learner directory** — learners now belong to the **school**, not to the teacher who created them. Every teacher in the same school sees the same learner directory: the enrol picker, the Learners tab and search all show the school's learners, so a class uploaded once never needs uploading again. A teacher can never see or touch another school's learners.
5. **Learners tab** — on the Classes & Sections page, a class selector switches between the whole school directory and one class's roster, with search and the same columns and 3-dots actions. This is where a 50-student roster lives; the enrol modal still works for enrolling and quick-add.
6. **One dropdown everywhere** — every list in the system (classes, learners, schools, plans, grades, statuses and more) now uses the same dropdown: a field that opens a panel with a search input, rows with avatar initials, a name and a second line, and a count footer ("2 students"). It closes on selection and on Escape, and it never closes its parent modal.
7. **Whole-week meetings** — when adding a meeting in Manage Class Schedules, tick **Repeat for the whole week (Monday–Friday)** to add one meeting per weekday at the same time and room. A day that would conflict is skipped and reported ("Tuesday — …"), and the rest are still added. Adding a single day works as before.
8. **Modals stay put** — clicking outside a modal no longer closes it. Use the X button or the Cancel/Close button.
9. **Attendance Mark menu** — the Mark control is now a 3-dots menu at the right end of each learner row: Present, Late, Absent, Excused. Picking a status marks it; picking the same status again clears it. Time-in stamping, QR display and saving are unchanged.
10. **Attendance filter pills** — the active pill text is now readable in light and dark mode.
11. **Grades** — the page follows the earlier design (class record header, period tabs, formula strip, five summary stats, encoding table) with the logic unchanged. When you are **both** the subject teacher of the class **and** the adviser of that section, the button reads **Move to Consolidation** and files the grades straight into Consolidation. When you are a subject teacher only, it stays **Submit to Adviser** with the checklist, and the adviser can still remind you. Consolidation shows directly-filed grades exactly like submitted ones.

### Bulk learner upload (CSV)

On the Learners tab, **Upload CSV** adds many learners at once.

1. Click **Download template** to get the CSV with the header row. The columns are exactly these, in this order:

```
first_name,last_name,learner_id,sex,birthdate
```

2. One learner per row. `first_name`, `last_name` and `learner_id` are required. `sex` must be `Male` or `Female` (upper or lower case is fine). `birthdate` is optional, in `YYYY-MM-DD` form, and cannot be in the future. A name with a comma in it must be wrapped in double quotes, for example `"Rivera, Jr.",Alex`.
3. Choose the file (CSV only, at most 500 rows, at most 2 MB) and upload. Every row is reported: **added**, **skipped as duplicate** (a learner with that ID already exists in your school — the existing learner is never overwritten), or **error** with the reason and the row number. A bad row never stops the good rows.

### The shared learner directory

A learner belongs to one school. When a teacher creates a learner, uploads learners, or enrols a learner, it is always within their own school. Two teachers in the same school who both created the same learner ID are merged by the Batch 7 migration (the earliest learner is kept, the other one's enrolments, attendance and grades move to it). A learner ID can be reused in a different school.

## Upgrading from Admin Part 2

Your `.env` file and everything in your database are kept. You do not run the seed again.

1. Stop the backend and the frontend (press Ctrl+C in both terminals).
2. Unzip the Teacher Batch 1 zip **over your existing `acadsync` folder** and choose **Replace** when Windows asks. Your `backend/.env` is not in the zip, so it stays as it is.
3. In the first terminal:

```
cd backend
npm install
npm run migrate
npm run dev
```

`npm run migrate` should print `Applied 003_teacher_portal.sql`. It adds the teacher sign-in and password-reset tables and the advisory fields on teachers and does not touch your existing teachers, schools, subscriptions, invoices or accounts.

4. In the second terminal:

```
cd frontend
npm install
npm start
```

5. Open http://localhost:4200 and sign in as before. Teachers now have their own sign-in at http://localhost:4200/teacher/login and a sign-up page at http://localhost:4200/teacher/create-account. See [The teacher side](#the-teacher-side).

No new `.env` settings are required.

## The teacher side

Teachers use their own portal at http://localhost:4200/teacher/login. It is separate from the admin console: admin and teacher sign-ins use different tokens, so a teacher token cannot open admin pages and an admin token cannot open teacher pages.

### How a teacher signs up

1. The teacher opens http://localhost:4200/teacher/create-account.
2. **Profile & Assignment**: first name, surname, email, mobile number, school (chosen from the schools already in the system) and present address (optional). If their school is not listed, **School not in the list? Add a school** opens a form for the school name, category (Primary/Secondary), type (Public/Private), city or region, and principal/contact. The new school is added at once and can be picked straight away. The admin can review it later under **Schools**.
3. **Credentials**: the username is made from the email address (for example `maria.santos` from `maria.santos@example.com`). If that username is already taken a number is added. The password needs at least 8 characters with a letter and a number, and a strength meter shows how strong it is.
4. **Security & Terms**: the teacher agrees to the terms and the privacy notice, then the account is created.
5. **Choose Plan**: the plans come from **Plans & Packages** in the admin console. **Teacher Free** is ₱0.00 for 1 month only and makes no invoice. **Teacher Pro** is ₱100.00 / month with a 1-month trial first; when the trial ends an invoice of ₱100.00 is made (see [How billing works](#how-billing-works)). Choosing a plan creates the subscription straight away.
6. **Get Started**: a short checklist, then **Go to Dashboard**.

### How a teacher signs in

The teacher signs in at http://localhost:4200/teacher/login with their username or email and password. After 5 wrong passwords the account is locked for 15 minutes. **Forgot password?** sends a reset link; the link works once and expires after 30 minutes. While email is not set up, the link is printed in the backend terminal (same as the admin reset link). **Remember this device** (checked by default) keeps the teacher signed in for 30 days instead of the usual 8 hours; unchecking it signs the teacher out after 8 hours as before.

A teacher created by an admin (**Teachers > Add teacher**) signs in with the temporary password the admin gave them, and the dashboard asks them to change it on their **Profile** page.

A restricted teacher sees a clear message with the reason the admin gave. The admin restricts and unrestricts teachers from the teacher profile in the admin console.

### Teacher Dashboard and Profile

- **Dashboard** (http://localhost:4200/teacher/dashboard) shows the teacher's own plan (status, price, when the period ends, what happens next), announcements for their plan, and their advisory assignment. The adviser form (adviser yes/no, advisory grade 7–12, advisory section) files an assignment slip on save and updates straight away. The **Classes & Sections** card shows how many classes and learners the teacher has and today's classes (the class in progress marked **Now**, the following one **Next**). The plan card links to **Payments & Invoices**.
- The sidebar lists **Classes & Sections**, **Schedules**, **Attendance**, **Grades**, **Consolidation**, **Report Card**, **Payments & Invoices** and **Profile**, all live — nothing is marked **Soon** any more.
- **Profile** lets the teacher change their first name, surname, email, mobile number and present address, and change their password (current password required). The teaching assignment is read-only there; it is changed on the Dashboard.
- The Dashboard also shows a **Consolidation** card for the teacher's advisory section: how many of its subjects have filed their grades for the current term (for example "2 of 3 submitted"), with a link to the Consolidation page. A teacher with no advisory assignment sees a note to set one in **My Assignment** instead.

### Payments & Invoices

**Payments & Invoices** (http://localhost:4200/teacher/payments) holds the teacher's own plan, plans, invoices and receipts.

- **My plan** shows the current plan, its status (trial / active / past due / expired / cancelled), price, period end, and days left. A past-due or expired subscription shows a banner stating what is owed and what happens next: the invoice is due 7 days after it is made, and if it is not paid by then the subscription expires.
- **Plans** lists the active plans from the database with their prices and marks the current plan. A teacher with no current subscription chooses a plan here; a teacher with one changes plan here. See [How billing works](#how-billing-works) for the trial-once and voiding rules.
- **Invoices** lists the teacher's own invoices with number, plan, amount, issue date, due date and status: **Unpaid**, **Waiting for confirmation**, **Paid** or **Void**. Opening one shows it as a receipt with its payment history.
- To pay an unpaid invoice, open it and follow **Pay this invoice**: scan the administrator's QR code (set in **Settings > Payment QR code**) and pay the exact amount — a part payment is not accepted — then enter the reference number, the date paid, and a screenshot of the payment confirmation (PNG, JPG or WEBP, up to 2 MB), and send it. The invoice then shows **Waiting for confirmation**. If the administrator rejects it, the invoice shows the reason and the teacher can send a new payment. A paid invoice shows as a paid receipt.
- Only the signed-in teacher's own subscription, invoices and payments are visible. A teacher pays by scanning the QR code only; there is no online payment gateway in this version.

### Classes & Sections and Schedules

**Classes & Sections** (http://localhost:4200/teacher/classes) holds only the signed-in teacher's own data — a teacher never sees another teacher's classes.

- **Subjects**: **Manage Subjects** opens the teacher's own subject library. Add a subject with its name, grade level (7–12) and group (Core, MAPEH or EPP/TLE — the group decides the default grade weights; see [Grading systems](#grading-systems)). A subject's name and group can be changed, but its grade cannot. A subject that a class uses cannot be deleted.
- **Classes**: **Add class & section** picks an existing subject or creates a new subject on the spot (name and grade level), then the section name, room and academic year (filled in from Settings). A class is one subject, one grade, one section, one room, one school year. **View sections** opens a subject's sections; each section shows its room, how many learners are enrolled and how many meetings it has, and **Details** lists its meetings and learners. Edit changes the subject, section, room or school year; Delete removes the class with its enrolments and meetings, after confirmation.
- **Learners**: the **Learners** tab is the teacher's learner directory. A learner has a first name, surname, learner ID (for example `STU-2026-1048`) and sex. Add, edit and delete learners there. **Enrol learners** on a section adds learners from the directory, or adds a brand new learner and enrols them at once; **Remove** takes a learner out of that section. The student count on every class is the real enrolment count. **QR card** on a learner opens their QR pass card: the QR code holds their learner ID and is what the Attendance scanner reads. Print the card (one per learner) or download it as a PNG.
- The tiles/list switch changes the layout, and the search box, grade filter and school-year filter narrow the list.

**Schedules** (http://localhost:4200/teacher/schedules) is the teacher's weekly timetable, built from their own meetings only.

- **Manage Class Schedules** adds a meeting: class, day of week (Monday–Friday), start time, end time and room. A meeting that overlaps another meeting of the same teacher is refused, and so is a room that another teacher of the same school already uses at that time. Meetings can be edited and deleted from the same window.
- **Weekly Timetable Grid** shows the week Monday to Friday with every meeting in its time slot. **Daily Agenda** lists one day's meetings in order, with the class in progress marked **Now** and the following one **Next**. **Faculty Matrix** shows each class across the week, and **Room Occupancy** shows each room across the week.
- The previous/next arrows move a week at a time, **Today** jumps back to this week, and the class filter narrows every tab to one class. **Export CSV** downloads the week's timetable as a CSV file.
- Classes with no meeting yet are listed in a warning at the top ("1 class without a saved meeting schedule") with an **Add a meeting** button. The warning clears once every class has a meeting.
- Meetings repeat every week by day of week, so the timetable looks the same from week to week until a meeting is changed.

### Attendance

**Attendance** (http://localhost:4200/teacher/attendance) is the teacher's daily roll sheet, built from the real enrolment list. It holds only the signed-in teacher's own classes and learners.

- **Taking the roll**: pick the class and the date (today by default; a future date is refused). The class defaults to the teacher's first class that meets today, or the first class. Tap **Present**, **Late**, **Absent** or **Excused** for a learner; tapping the same status again clears it. Present and Late stamp the time-in (Manila time) and the method automatically; Absent and Excused have no time-in. The roll-progress bar and the counts (enrolled, present, late, absent, excused, QR check-ins, attendance rate) update live. Filter chips (All / Present / Late / Absent / Excused / Not marked) and the search box narrow the roster by name or learner ID.
- **Saving**: **Save attendance** files the whole roll for that class and date in one go. Re-saving the same date replaces it; a learner whose status did not change keeps the time they first arrived. **Discard changes** goes back to the last saved roll, and **Mark all present** marks everyone not yet marked. The note under the progress bar says whether the roll is saved, when it was saved, or that there are unsaved changes. A class with no learners shows an empty state with a link to enrol learners first.
- **CSV**: **CSV** downloads the day sheet for the selected class and date (learner ID, name, sex, status, time-in, method).
- **QR check-in**: print each learner's QR pass card from **Classes & Sections > Learners** (or from a section's **Details**). On the Attendance page, **Scan QR code** opens the scanner modal only — there is no scanner panel on the page itself. **Start scanning** opens the device camera (the rear camera on a phone) and reads the pass; **Stop scanning** closes it. **Simulate a pass scan** pretends a pass was scanned, for testing without a camera. Or type a student ID (a connected barcode reader types it into the same box) and press **Check in**. A scan or ID lookup shows the learner's card (name, learner ID, class, current status for that day) for confirmation BEFORE it counts, and refuses with a clear message when the learner is not enrolled in the selected class. **Confirm check-in** marks them Present via QR with the time-in stamped; **Scan next** reads another pass, **Done** closes the modal. A learner already checked in by QR keeps their first time-in.
- **When the camera is denied**: the modal says so plainly and the manual student-ID entry still works. The camera needs the browser's permission and a secure page: it works on `http://localhost:4200` and on `https://` sites. If you open the site on a phone through a plain `http://` address on your local network, the browser blocks the camera — use the manual student-ID entry there, or serve the site over `https://`.

### Grading systems

The grading system is a switch, one per academic year — changing next year's system never changes this year's grades. An admin chooses it in **Settings > Academic year**, next to the academic year. There are three systems:

- **DO 8 · s. 2015** — the old system: 4 quarters, components Written Works / Performance Tasks / Quarterly Assessment, default weights WW 30% / PT 50% / QA 20%, and the DO 8 transmutation table (initial 60 becomes 75).
- **DO 015 · Adjusted** — DepEd Order No. 015, s. 2026 for SY 2026–2027 (the system your current year runs on): 3 terms, components Written Works / Performance Tasks / Examinations, default weights WW 20% / PT 50% / Examinations 30% for core subjects and 20% / 60% / 20% for MAPEH and EPP/TLE, and the adjusted transmutation table (initial 70 becomes 75; the lowest term grade is 60).
- **DO 015 · Zero-based** — the same three terms and weights, from SY 2027–2028: no transmutation, so the term grade is the initial grade itself, rounded to a whole number (75 is still the passing grade).

**What happens to grades already filed when you switch.** A filed submission keeps the system it was filed under, so a switch never recomputes a filed grade. And once any grade has been filed for a year, that year's system cannot be changed at all — Settings refuses the change and says so. To move to a new system, change it for the next academic year instead. A class that has scores but no filing yet follows the new system's defaults when the year switches (its scores are kept; only the weights and the table change).

**Quarter 4.** Under DO 015 a year has three terms, so Quarter 4 is not offered. Any Quarter 4 data you already have is kept in the database exactly as it is: it is readable again if the year is switched back to DO 8, and it is never deleted.

**Grade 12.** Under DO 015, Grade 12 keeps the DO 8 weights for SY 2026–2027. The per-class weight override on the Grades page already covers this: a Grade 12 teacher sets WW 30% / PT 50% / Examinations 20% by hand on **Edit weights**.

**Subjects and default weights.** Each subject has a group — Core, MAPEH, or EPP/TLE — set in **Classes & Sections > Manage Subjects** (a subject created on the spot takes its group from its name; Music and Arts is MAPEH). The group decides the default weights for that subject's classes: 20/50/30 for Core, 20/60/20 for MAPEH and EPP/TLE. A teacher can still change the weights per class on the Grades page.

### Grades and Academic Consolidation

**Grades** (http://localhost:4200/teacher/grades) is the teacher's own class record, built from the real enrolment list. A teacher only ever sees and encodes grades for their own classes.

- **Encoding scores**: pick the class and the period (Terms 1–3 under DO 015, Quarters 1–4 under DO 8; the page opens on the highest period that already has data). The first time a class and period is opened, the standard columns appear: Written Works WW1–WW4 (highest possible score 25 each), Performance Tasks PT1–PT4 (50 each) and, under DO 015, Examinations — Summative Test 1, Summative Test 2 and Term Exam (50 each). Under DO 8 the third component is a single Quarterly Assessment column, QA1 (50). Every cell starts blank — a blank cell is not a zero. Type a score from 0 up to the column's highest possible score; a score over the maximum is refused. On a phone the table becomes one card per learner with the same score boxes.
- **How the grades are worked out**: for each component, PS = (total of the encoded scores ÷ total of the highest possible scores of the *encoded* columns only) × 100, so a blank column does not drag the average down. For Examinations under DO 015 the PS is the sub-weighted mean of the three tests (see below). WS = PS × the component weight. The initial grade is the sum of the three WS values once every component has a PS, and the term grade (TG) or quarterly grade (QG) follows the active grading system: the DO 8 transmutation table (100 → 100, 60 → 75, the passing mark, lowest grade 60), the DO 015 adjusted table (70 → 75, lowest grade 60), or no transmutation at all under zero-based (the initial grade itself, rounded). The page shows which system is active, for example "DO 015 · Adjusted · SY 2026–2027". A learner with nothing encoded in a component shows — for that component, not 0. The numbers update live as the teacher types, and the same formula runs on the server when the sheet is saved, so what the teacher sees is what gets filed. The descriptor for a grade (Advancing 90–100, Benchmarking 80–89, Connecting 75–79, Developing 65–74, Emerging below 65) shows on the learner cards and as a tooltip on the grade.
- **Summary stats**: mean percentage score, passing rate, highest term grade, the learners below 75 who need intervention, and encoding progress. The search box, All/Male/Female filter, **Highlight < 75** and **Sort by rank** narrow the list. **Recalculate all** re-reads the saved scores and recomputes everything.
- **Columns and weights**: **Add a column** appends WW5, PT5 or EX4 and so on, with the usual highest possible score for that component. Click a column's highest possible score to change it (it cannot go below a score already saved in that column). The × on a column removes it and its scores, after confirmation; the last column of a component cannot be removed. **Edit weights** changes the three weights (default WW 20% / PT 50% / Examinations 30% for a core subject under DO 015, 20% / 60% / 20% for MAPEH and EPP/TLE, 30% / 50% / 20% under DO 8); they must add up to 100%. Under DO 015 the same window edits the **Examinations shares** — Summative Test 1 (30%), Summative Test 2 (30%) and Term Exam (40%) by default; the shares must add up to 100%. A new Examinations column starts at 0%, and removing one rescales the rest so they still add to 100%. Changing the weights clears any submission for that class, because the filed grades were worked out with the old weights — and since weights apply to every period of the class, a weights change clears the filings for all its periods, not just the open one.
- **Saving**: **Save scores** files the scores that changed. **Discard changes** goes back to the last saved scores. The note under the class name says whether there are unsaved changes, whether the period is saved, or when it was submitted. **CSV** downloads the class/period grade sheet (scores, PS, WS, initial grade, TG/QG and status).
- **Submit to adviser**: **Submit to adviser** opens a checklist — encoding progress, how many records are complete, how many cells are encoded, who is still incomplete and who is below 75. When every record is complete, **Submit grades** files the period with the adviser and the page shows **Submitted** with the date and time. When some records are incomplete, the teacher must tick **Submit anyway** first; the blanks stay blank in the consolidation. Re-submitting after edits replaces the submission. Any change to scores, columns or weights after a submission clears the submission, so the adviser only ever sees filed grades.
- **Reminders**: when the adviser asks a teacher to file a period (see Consolidation below), a banner appears at the top of that teacher's Grades page: "Your adviser asked you to submit grades for \<subject\>, Term \<n\>." It stays until the teacher files that period again.

**Academic Consolidation** (http://localhost:4200/teacher/consolidation) gathers every subject grade for the signed-in teacher's advisory section (the grade and section set on the Dashboard), across all teachers of the same school, for the selected term (or quarter under DO 8). A teacher with no advisory assignment sees an empty state telling them to set it on the Dashboard; a teacher who is not the adviser of a section cannot open that section's consolidation.

- **Readiness**: the top bar shows how many subjects have filed (for example "2 of 3 subjects submitted") and the four summary cards show the class GWA, the subject average, how many learners have honors, and how many are at risk. GWA is the mean of the term grades across *submitted* subjects only, and it shows — with the reason named ("Waiting on \<subjects\>" or "Incomplete in \<subjects\>") until every subject is filed.
- **Subject cards**: each subject shows its teacher, whether it is filed, its average, and a **Remind teacher** button while it is still waiting. Reminding sends the banner described above to that subject teacher's Grades page; the card then says **Reminder sent**.
- **Learner table**: one column per subject (the term grade, — when not filed) plus GWA, standing and rank. Honors follow the active grading system: under DO 015 the **Academic Excellence Award** (general average 90 or higher with no grade below 80); under DO 8, With Honors 90–94, With High Honors 95–97, With Highest Honors 98–100. At risk is any subject below 75 or a GWA below 75. The **All / Honors / At risk** tabs and the search box narrow the table. **Refresh** re-reads the sheet, and **Export / Rankings CSV** downloads the consolidated sheet (one row per learner, GWA, standing and rank).
- **Final grades**: below the term table, the **Final grades** section shows each subject's final grade — the mean of its term grades, only once every term is filed for that subject — and the final GWA for each learner, with its own summary cards and an **Export final grades CSV** button. Under DO 8 the final grade is the mean of the four quarterly grades instead.

### Report Card

**Report Card** (http://localhost:4200/teacher/report-card) prints the DepEd School Form 9 for the signed-in teacher's advisory section (the grade and section set on the Dashboard). A teacher with no advisory assignment sees an empty state telling them to set it on the Dashboard; a teacher who is not the adviser of a section cannot open that section's cards. The card itself is strictly black and white, plain white paper, in any mode.

- **What is filled in**: nothing on the card is typed from scratch except the teacher's comments (below). The learner's name, learner ID, grade level and section come from the enrolment list; the school name comes from the teacher's school record and appears only on the printed card, never in the app. The **Learning Progress** table lists one row per subject the advisory section has in Consolidation — the real subjects with submitted grades, in the same order — with one column per period (Terms 1–3 under DO 015, Quarters 1–4 under DO 8). The Final Grade for a subject is the mean of its period grades, rounded to a whole number; the General Average is the mean of the Final Grades and only shows once every subject has a final grade. Remarks are **Passed** at 75 and above, **Failed** below. A period or subject with no submitted grade shows —, never an invented number. The **Attendance** table on the back counts school days from the real attendance records for the learner's classes, June to April: a day counts as present when marked Present or Late in at least one class that day, otherwise excused when excused in at least one class, otherwise absent. A month with no records shows —. The performance descriptors under the table follow the active grading system for the school year.
- **Teacher's comments**: the only typed content on the card. On the back, each term (or quarter under DO 8) has a box where the adviser types a comment and clicks **Save comment**. The button stays disabled until the text differs from what is saved, and a blank comment clears the saved one. Saved comments print as plain text on the card; a term with no comment prints as ruled lines for handwriting. Everything else on the back — the Dear Parents letter, parent signatures, Certificate of Transfer and Cancellation of Eligibility to Transfer — prints as-is for handwriting.
- **Views and printing**: pick **Single student card** or **All students in advisory** (roster order), then **Front**, **Back** or **Both sides**. **Print card** (or Ctrl/⌘+P) prints at A5, 100%, margins None — one card per printed page, front then back, with the sidebar, top bar and all controls hidden. Print-all prints one front + back card per learner, each with that learner's name filled in.

### What the admin sees

- A teacher who signed up appears in **Teachers** with their school and plan, exactly like a teacher added by an admin. The admin can view their profile, restrict or unrestrict them, and reset their password.
- A school added by a teacher during sign-up appears in **Schools** and can be edited or merged like any other school.
- Sign-ups are written to the **Activity Log**.

## How billing works

- **Plans & Packages** holds the plans and prices. A plan that teachers have used cannot be deleted, only deactivated.
- **Subscriptions** belong to one teacher each. A teacher has one current subscription at a time. Each subscription keeps its own copy of the plan name and price, so changing a plan's price later does not change existing subscriptions or invoices.
- **Teacher Free** runs for 1 month and then expires by itself. No invoice is made.
- **Teacher Pro** starts with a 1-month trial. When the trial ends an invoice of ₱100.00 is made and the subscription shows **Past due** until it is paid. A new invoice is made at every monthly renewal.
- The trial is given **once per teacher**. A teacher who has already had a trial — on any subscription — never gets a second one, even on a new subscription. A teacher who has not had a trial yet gets one the first time they take Teacher Pro.
- A teacher can change plan on the **Payments & Invoices** page. Changing plan ends the old subscription and starts a new one on the new plan; any unpaid invoice on the old subscription is voided. Changing plan while a payment is waiting for confirmation is refused. A teacher with no current subscription can choose a plan the same way.
- An invoice is due 7 days after it is made (`INVOICE_DUE_DAYS`). If it is still unpaid after the due date and no payment is waiting for confirmation, the subscription becomes **Expired**.
- These changes happen by themselves: the backend checks when it starts, every 10 minutes while it runs, and whenever a billing page is opened.
- **Payments & Invoices**: open an invoice and choose **Record payment** to enter a payment by hand, or open a payment a teacher sent and **Confirm** or **Reject** it. Confirming marks the invoice paid and activates the subscription for that period.
- **Settings > Payment QR code** holds the QR image, account name and instructions that teachers will see when they pay.
- Uploaded images (payment screenshots and the QR code) are saved in `backend/uploads`. Only PNG, JPG and WEBP up to 2 MB are accepted, and only signed-in admins can open them. Back this folder up together with the database. On hosts that wipe the disk on every deploy (for example Render free), uploaded images are lost on redeploy.

Addresses the teacher portal uses (they work now):

| Address | Purpose |
| --- | --- |
| `GET /api/teacher-auth/schools` | schools for the sign-up form (no sign-in needed) |
| `POST /api/teacher-auth/register/school` | add a school during sign-up (no sign-in needed) |
| `POST /api/teacher-auth/register` | teacher sign-up (no sign-in needed) |
| `POST /api/teacher-auth/login` | teacher sign-in, returns a token for the addresses below |
| `GET /api/plans/active` | plans for the Choose Plan screen (no sign-in needed) |
| `GET /api/teacher/dashboard` | the teacher's plan, announcements and profile for the Dashboard |
| `GET /api/teacher/me`, `PATCH /api/teacher/me` | the teacher's own profile |
| `PATCH /api/teacher/me/adviser` | the teacher's own advisory assignment |
| `POST /api/teacher/change-password` | change the teacher's own password |
| `GET /api/teacher/announcements` | announcements for the signed-in teacher |
| `GET /api/teacher/subscription`, `POST /api/teacher/subscription` | the teacher's own subscription |
| `POST /api/teacher/subscription/change-plan` | change the teacher's plan; voids unpaid invoices, trial given once |
| `GET /api/teacher/invoices` | the teacher's own invoices |
| `GET /api/teacher/invoices/:id` | one of the teacher's own invoices with its payment history |
| `POST /api/teacher/invoices/:id/payments` | send a payment: reference number and screenshot |
| `GET /api/teacher/payment-info` and `GET /api/teacher/payment-info/qr` | account name, instructions and the QR image |
| `GET /api/teacher/attendance?class_id=&date=` | the roll for one class and date (add `&format=csv` to download the day sheet) |
| `POST /api/teacher/attendance` | save the whole roll for one class and date |
| `GET /api/teacher/attendance/lookup?class_id=&date=&code=` | resolve a scanned QR code or typed student ID to the learner, for confirmation |
| `POST /api/teacher/attendance/check-in` | confirm a QR check-in: marks the learner Present via QR |

## Everyday use

Each time you want to work on the project, start both parts:

```
cd backend
npm run dev
```

```
cd frontend
npm start
```

## Who can do what

| | Super User | Admin |
| --- | --- | --- |
| Teachers, schools, overview, activity log | Yes | Yes |
| Plans, subscriptions, payments & invoices, reports, announcements, payment QR code | Yes | Yes |
| Own profile and password, academic year | Yes | Yes |
| Edit, enable or disable the Admin account | Yes | No |
| Reset the Admin password, unlock the Admin account | Yes | No |

Nobody can change the Super User account except the Super User.
There is no sign-up page for admin accounts. They are created only by `npm run seed`.

## Passwords and lockout

- After 5 wrong passwords an account is locked for 15 minutes.
- **Forgot password** on the sign-in page sends a reset link. The link works once and expires after 30 minutes.
- Email is not set up yet, so the reset link is **printed in the backend terminal**. Copy it into your browser. To send real emails, fill in the `SMTP_*` settings in `backend/.env`.
- If the Admin password is lost, the Super User resets it in **Settings > Admin account**.
- If both passwords are lost and email is not set up, put new passwords in `backend/.env` and run:

```
cd backend
npm run seed:reset
```

- Teacher passwords are never shown. **Reset password** on a teacher profile creates a temporary password that is displayed once.

## Automated tests

Inside `backend`:

```
npm test
```

The tests need a local PostgreSQL. They create and use a separate database named `acadsync_test` and wipe it on every run. Your real data is not touched: the tests refuse to start when the test database is the same as your real one (`TEST_DB_NAME` equal to `DB_NAME`, or `TEST_DATABASE_URL` equal to `DATABASE_URL`).

On Neon, skip the tests, or set `TEST_DATABASE_URL` in `.env` to a separate, empty database.

## Build the frontend for release

Inside `frontend`:

```
npm run build
```

The finished files are placed in `frontend/dist/frontend/browser`.
Before deploying, set the address of your live API in `frontend/src/environments/environment.ts`, and set `FRONTEND_URL` in the backend `.env` to the address of your live site.

## Check a restricted teacher

In a **Git Bash** terminal (replace USERNAME and PASSWORD):

```
curl -X POST http://localhost:3000/api/teacher-auth/login -H "Content-Type: application/json" -d '{"login":"USERNAME","password":"PASSWORD"}'
```

A restricted teacher gets `ACCOUNT_RESTRICTED` together with the reason. On the sign-in page the same teacher sees the reason in plain words.

## Troubleshooting

| Problem | Fix |
| --- | --- |
| `password authentication failed for user "postgres"` | `DB_PASSWORD` in `backend/.env` is wrong |
| `database "acadsync" does not exist` | Do step 3 |
| `ECONNREFUSED ... 5432` | PostgreSQL is not running. Open **Services** in Windows and start `postgresql` |
| `The tables do not exist yet` | Run `npm run migrate`, then `npm run seed` |
| `The tables are missing. Run "npm run migrate" first.` when starting the backend after an upgrade | Run `npm run migrate` inside `backend` |
| `Missing script: "migrate"` or `Could not read package.json` | You are not inside `backend`. Run `cd backend` first |
| Seed says a password is missing or not valid although you typed it | The value contains `#` without double quotes, or the file is not named exactly `.env`, or it was not saved |
| `npm start` in `frontend` says the Node.js version is not supported | Install Node.js 24.15 or newer |
| Yellow `SSL` security warning when using Neon | Harmless. Nothing to do |
| `The image is too large` or `Upload a PNG, JPG or WEBP image` | Use a PNG, JPG or WEBP picture of 2 MB or less |
| `JWT_SECRET is missing or too short` | Do the `JWT_SECRET` part of step 5 |
| Seed says a value is not valid | Fix the values it lists in `backend/.env` and run `npm run seed` again |
| Sign-in page says `Cannot reach the server` | The backend is not running. Do step 9 |
| `Port 3000 is already in use` | Close the other backend terminal, or change `PORT` in `.env` and the address in `frontend/src/environments/environment.ts` |
| `Port 4200 is already in use` | Close the other frontend terminal |
| `npm` or `node` is not recognized | Close and reopen VS Code after installing Node.js |
| `running scripts is disabled on this system` (PowerShell) | Use **Command Prompt** as the terminal type in VS Code, or run `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned` once |
| `Too many requests` on sign-in | Wait 15 minutes, or restart the backend |

## Project map

```
backend/
  migrations/        SQL files that create the tables (001 = Part 1, 002 = Part 2, 003 = Teacher Batch 1, 004 = Batch 2, 005 = Batch 3, 006 = Batch 4)
  scripts/           migrate.js and seed.js
  src/
    server.js        starts the API
    app.js           builds the Express app
    routes.js        every API address in one place
    controllers/     what each address does
    middleware/      sign-in check, input validation, errors, rate limit
    validators/      the rules for every form
    utils/           passwords, email, activity log, migrations, billing rules, uploads, CSV, DepEd grade computation (deped.js)
  uploads/           payment screenshots and the QR code (created when first needed)
  tests/             automated API tests

frontend/src/app/
  core/              services (API calls), guards, interceptor, models
  layout/            sidebar and top bar (admin and teacher)
  pages/             one folder per page (admin pages and teacher/ pages)
  shared/            small reusable parts (modal, icons, pagination)
```
