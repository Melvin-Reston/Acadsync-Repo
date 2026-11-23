// Every API address in one file, so it is easy to see what exists and who may use it.
const express = require('express');
const { requireAuth, requireRole } = require('./middleware/auth');
const { validate } = require('./middleware/validate');
const { authLimiter } = require('./middleware/rateLimit');
const s = require('./validators/schemas');

const auth = require('./controllers/auth.controller');
const adminAccount = require('./controllers/adminAccount.controller');
const teachers = require('./controllers/teachers.controller');
const schools = require('./controllers/schools.controller');
const system = require('./controllers/system.controller');
const plans = require('./controllers/plans.controller');
const subscriptions = require('./controllers/subscriptions.controller');
const invoices = require('./controllers/invoices.controller');
const reports = require('./controllers/reports.controller');
const announcements = require('./controllers/announcements.controller');
const teacherPortal = require('./controllers/teacherPortal.controller');
const teacherAuth = require('./controllers/teacherAuth.controller');
const classes = require('./controllers/classes.controller');
const attendance = require('./controllers/attendance.controller');
const grades = require('./controllers/grades.controller');
const reportCard = require('./controllers/reportCard.controller');
const { requireTeacher } = require('./middleware/teacherAuth');
const { uploadSingle } = require('./utils/uploads');

const router = express.Router();
const idParam = validate(s.idParamSchema, 'params');

router.get('/health', (req, res) => res.json({ status: 'ok' }));

// ---------- Public (no sign-in needed). There is no admin sign-up route. ----------
router.post('/auth/login', authLimiter, validate(s.loginSchema), auth.login);
router.post('/auth/forgot-password', authLimiter, validate(s.forgotPasswordSchema), auth.forgotPassword);
router.post('/auth/reset-password', authLimiter, validate(s.resetPasswordSchema), auth.resetPassword);

// Teacher sign-up and sign-in (public). Teachers sign up themselves; admins never do.
router.get('/teacher-auth/schools', teacherAuth.listPublicSchools);
router.post('/teacher-auth/register/school', authLimiter, validate(s.schoolSchema), teacherAuth.registerSchool);
router.post('/teacher-auth/register', authLimiter, validate(s.teacherRegisterSchema), teacherAuth.register);
router.post('/teacher-auth/login', authLimiter, validate(s.teacherLoginSchema), teacherAuth.login);
router.post('/teacher-auth/forgot-password', authLimiter, validate(s.forgotPasswordSchema), teacherAuth.forgotPassword);
router.post('/teacher-auth/reset-password', authLimiter, validate(s.resetPasswordSchema), teacherAuth.resetPassword);

router.get('/plans/active', plans.listActivePlans); // for the Choose Plan screen

// ---------- Teacher-facing routes (need a teacher token from /teacher-auth/login) ----------
const teacher = express.Router();
teacher.use(requireTeacher);
teacher.get('/me', teacherPortal.getMe);
teacher.get('/academic-years', teacherPortal.listAcademicYears);
teacher.patch('/me', validate(s.teacherProfileSchema), teacherPortal.updateMe);
teacher.patch('/me/adviser', validate(s.teacherAdviserSchema), teacherPortal.updateAdviser);
teacher.post('/change-password', validate(s.changePasswordSchema), teacherPortal.changePassword);
teacher.get('/dashboard', validate(s.viewingYearQuerySchema, 'query'), teacherPortal.getDashboard);
teacher.get('/holidays', teacherPortal.listHolidays);
teacher.post('/holidays', validate(s.holidaySchema), teacherPortal.addHoliday);
teacher.delete('/holidays/:id', idParam, teacherPortal.deleteHoliday);
teacher.get('/today-classes', teacherPortal.getTodayClasses);
teacher.get('/subscription', teacherPortal.getMySubscription);
teacher.post('/subscription', validate(s.teacherSubscriptionSchema), teacherPortal.createMySubscription);
teacher.post('/subscription/change-plan', validate(s.teacherSubscriptionSchema), teacherPortal.changeMyPlan);
teacher.get('/announcements', teacherPortal.listMyAnnouncements);
teacher.get('/payment-info', teacherPortal.getPaymentInfo);
teacher.get('/payment-info/qr', teacherPortal.getPaymentQr);
teacher.get('/invoices', teacherPortal.listMyInvoices);
teacher.get('/invoices/:id', idParam, teacherPortal.getMyInvoice);
teacher.post('/invoices/:id/payments', idParam, uploadSingle('screenshot'), validate(s.paymentSubmitSchema), teacherPortal.submitPayment);

// Classes & Sections and Schedules (Batch 2): the teacher's own data only.
teacher.get('/subjects', classes.listSubjects);
teacher.post('/subjects', validate(s.subjectSchema), classes.createSubject);
teacher.get('/subjects/:id', idParam, classes.getSubject);
teacher.patch('/subjects/:id', idParam, validate(s.subjectSchema), classes.updateSubject);
teacher.delete('/subjects/:id', idParam, classes.deleteSubject);
teacher.get('/classes', validate(s.classListSchema, 'query'), classes.listClasses);
teacher.post('/classes', validate(s.classCreateSchema), classes.createClass);
teacher.get('/classes/:id', idParam, classes.getClass);
teacher.patch('/classes/:id', idParam, validate(s.classUpdateSchema), classes.updateClass);
teacher.delete('/classes/:id', idParam, classes.deleteClass);
teacher.get('/learners', validate(s.learnerListSchema, 'query'), classes.listLearners);
teacher.post('/learners', validate(s.learnerSchema), classes.createLearner);
teacher.get('/learners/upload-template', classes.downloadLearnerTemplate);
teacher.post('/learners/upload', uploadSingle('file'), classes.uploadLearners);
teacher.patch('/learners/:id', idParam, validate(s.learnerSchema), classes.updateLearner);
teacher.delete('/learners/:id', idParam, classes.deleteLearner);
teacher.get('/classes/:id/learners', idParam, classes.listClassLearners);
teacher.post('/classes/:id/learners', idParam, validate(s.enrolSchema), classes.enrolLearner);
teacher.delete('/classes/:id/learners/:learnerId', validate(s.classLearnerParamsSchema, 'params'), classes.removeLearner);
teacher.get('/meetings', validate(s.meetingListSchema, 'query'), classes.listMeetings);
teacher.post('/meetings', validate(s.meetingSchema), classes.createMeeting);
teacher.patch('/meetings/:id', idParam, validate(s.meetingUpdateSchema), classes.updateMeeting);
teacher.delete('/meetings/:id', idParam, classes.deleteMeeting);
teacher.get('/schedules', validate(s.scheduleQuerySchema, 'query'), classes.getSchedules);

// Attendance (Batch 3): the daily roll sheet and the QR check-in.
teacher.get('/attendance', validate(s.attendanceQuerySchema, 'query'), attendance.getRoll);
teacher.get('/attendance/sf2', validate(s.sf2QuerySchema, 'query'), attendance.getSf2);
teacher.post('/attendance', validate(s.attendanceSaveSchema), attendance.saveRoll);
teacher.get('/attendance/lookup', validate(s.attendanceLookupSchema, 'query'), attendance.lookupLearner);
teacher.post('/attendance/check-in', validate(s.attendanceCheckInSchema), attendance.checkIn);

// Grades and Consolidation (Batch 4): the teacher's own class records and the
// adviser's view of every subject grade for their section.
teacher.get('/grades/:id', idParam, validate(s.gradeSheetQuerySchema, 'query'), grades.getGradeSheet);
teacher.post('/grades/:id/scores', idParam, validate(s.gradeSaveScoresSchema), grades.saveScores);
teacher.post('/grades/:id/columns', idParam, validate(s.gradeAddColumnSchema), grades.addColumn);
teacher.patch('/grades/:id/columns/:columnId', validate(s.gradeColumnParamsSchema, 'params'), validate(s.gradeUpdateColumnSchema), grades.updateColumn);
teacher.delete('/grades/:id/columns/:columnId', validate(s.gradeColumnParamsSchema, 'params'), grades.deleteColumn);
teacher.patch('/grades/:id/sub-weights', idParam, validate(s.gradeSubWeightsSchema), grades.updateSubWeights);
teacher.patch('/grades/:id/weights', idParam, validate(s.gradeWeightsSchema), grades.updateWeights);
teacher.get('/grades/:id/submission-check', idParam, validate(s.gradeSheetQuerySchema, 'query'), grades.getSubmissionCheck);
teacher.post('/grades/:id/submit', idParam, validate(s.gradeSubmitSchema), grades.submitGrades);
teacher.get('/consolidation', validate(s.consolidationQuerySchema, 'query'), grades.getConsolidation);
teacher.post('/consolidation/remind', validate(s.remindSchema), grades.remindTeacher);

// Manual subjects in Consolidation (Batch 8 fix 10): the adviser creates
// the subject when its teacher has no AcadSync account, then uploads the
// term grades as a CSV. Grades arrive as JSON parsed by the frontend; the
// backend re-validates every row against the section roster.
teacher.get('/consolidation/manual-subjects', validate(s.viewingYearQuerySchema, 'query'), grades.listManualSubjects);
teacher.post('/consolidation/manual-subjects', validate(s.manualSubjectCreateSchema), grades.createManualSubject);
teacher.patch(
  '/consolidation/manual-subjects/:id',
  idParam,
  validate(s.manualSubjectUpdateSchema),
  grades.updateManualSubject
);
teacher.delete('/consolidation/manual-subjects/:id', idParam, grades.deleteManualSubject);
teacher.get('/consolidation/manual-subjects/:id/template', idParam, grades.downloadManualTemplate);
teacher.post(
  '/consolidation/manual-subjects/:id/grades',
  idParam,
  validate(s.manualGradesSchema),
  grades.fileManualGrades
);

// Report Card (Batch 5): the adviser's section, one card per learner, filled
// from the consolidated grades and the attendance records.
teacher.get('/report-card', validate(s.reportCardQuerySchema, 'query'), reportCard.getReportCards);
teacher.put('/report-card/comments', validate(s.reportCardCommentSchema), reportCard.saveComment);
router.use('/teacher', teacher);

// ---------- Everything below needs a signed-in Super User or Admin ----------
router.use(requireAuth);

// Own account
router.get('/auth/me', auth.me);
router.patch('/auth/me', validate(s.profileSchema), auth.updateProfile);
router.post('/auth/change-password', validate(s.changePasswordSchema), auth.changePassword);
router.post('/auth/logout', auth.logout);

// Overview
router.get('/overview', system.getOverview);

// Teachers
router.get('/teachers', validate(s.teacherListSchema, 'query'), teachers.listTeachers);
router.post('/teachers', validate(s.teacherCreateSchema), teachers.createTeacher);
router.get('/teachers/:id', idParam, teachers.getTeacher);
router.patch('/teachers/:id', idParam, validate(s.teacherUpdateSchema), teachers.updateTeacher);
router.post('/teachers/:id/restrict', idParam, validate(s.restrictSchema), teachers.restrictTeacher);
router.post('/teachers/:id/unrestrict', idParam, teachers.unrestrictTeacher);
router.post('/teachers/:id/reset-password', idParam, teachers.resetTeacherPassword);

// Schools
router.get('/schools', validate(s.schoolListSchema, 'query'), schools.listSchools);
router.get('/schools/options', schools.listSchoolOptions);
router.post('/schools/merge', validate(s.schoolMergeSchema), schools.mergeSchools);
router.post('/schools', validate(s.schoolSchema), schools.createSchool);
router.get('/schools/:id', idParam, schools.getSchool);
router.patch('/schools/:id', idParam, validate(s.schoolSchema), schools.updateSchool);

// Plans & Packages
router.get('/plans', plans.listPlans);
router.post('/plans', validate(s.planSchema), plans.createPlan);
router.patch('/plans/:id', idParam, validate(s.planSchema), plans.updatePlan);
router.post('/plans/:id/activate', idParam, plans.activatePlan);
router.post('/plans/:id/deactivate', idParam, plans.deactivatePlan);
router.delete('/plans/:id', idParam, plans.deletePlan);

// Subscriptions (one teacher, one plan)
router.get('/subscriptions', validate(s.subscriptionListSchema, 'query'), subscriptions.listSubscriptions);
router.post('/subscriptions', validate(s.subscriptionCreateSchema), subscriptions.createSubscription);
router.get('/subscriptions/:id', idParam, subscriptions.getSubscription);
router.post('/subscriptions/:id/extend', idParam, validate(s.subscriptionExtendSchema), subscriptions.extendSubscription);
router.post('/subscriptions/:id/cancel', idParam, validate(s.subscriptionCancelSchema), subscriptions.cancelSubscription);
router.post('/subscriptions/:id/change-plan', idParam, validate(s.subscriptionChangePlanSchema), subscriptions.changePlan);

// Payments & Invoices
router.get('/invoices', validate(s.invoiceListSchema, 'query'), invoices.listInvoices);
router.get('/invoices/:id', idParam, invoices.getInvoice);
router.post('/invoices/:id/void', idParam, validate(s.invoiceVoidSchema), invoices.voidInvoice);
router.post('/invoices/:id/payments', idParam, uploadSingle('screenshot'), validate(s.paymentSubmitSchema), invoices.recordPayment);
router.get('/payments', validate(s.paymentListSchema, 'query'), invoices.listPayments);
router.get('/payments/:id', idParam, invoices.getPayment);
router.get('/payments/:id/screenshot', idParam, invoices.getPaymentScreenshot);
router.post('/payments/:id/confirm', idParam, invoices.confirmPayment);
router.post('/payments/:id/reject', idParam, validate(s.paymentRejectSchema), invoices.rejectPayment);

// Reports (add ?format=csv to download)
router.get('/reports/income', validate(s.reportSchema, 'query'), reports.incomeReport);
router.get('/reports/subscriptions', validate(s.reportSchema, 'query'), reports.subscriptionsReport);
router.get('/reports/teachers-per-school', validate(s.reportSchema, 'query'), reports.teachersPerSchoolReport);

// Announcements
router.get('/announcements', validate(s.announcementListSchema, 'query'), announcements.listAnnouncements);
router.post('/announcements', validate(s.announcementSchema), announcements.createAnnouncement);
router.patch('/announcements/:id', idParam, validate(s.announcementSchema), announcements.updateAnnouncement);
router.delete('/announcements/:id', idParam, announcements.deleteAnnouncement);

// Activity log
router.get('/activity', validate(s.activityListSchema, 'query'), system.listActivity);

// Settings
router.get('/settings', system.getSettings);
router.put('/settings/academic-year', validate(s.academicYearSchema), system.updateAcademicYear);
router.put('/settings/grading-system', validate(s.gradingProfileSchema), system.updateGradingSystem);
router.put('/settings/payment', uploadSingle('qr_image'), validate(s.paymentSettingsSchema), system.updatePaymentSettings);
router.get('/settings/payment/qr', system.getPaymentQrImage);

// ---------- Super User only: manage the Admin account ----------
const superUserOnly = requireRole('super_user');
router.get('/admin-account', superUserOnly, adminAccount.getAdminAccount);
router.patch('/admin-account', superUserOnly, validate(s.adminAccountSchema), adminAccount.updateAdminAccount);
router.post('/admin-account/reset-password', superUserOnly, adminAccount.resetAdminPassword);
router.post('/admin-account/unlock', superUserOnly, adminAccount.unlockAdminAccount);

module.exports = router;
