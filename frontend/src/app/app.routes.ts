// Every page address of the console: the teacher portal first, then the admin console.
import { Routes } from '@angular/router';
import { authGuard, guestGuard } from './core/guards';
import { teacherGuard, teacherGuestGuard } from './core/teacher-guards';
import { TeacherLayoutComponent } from './layout/teacher-layout.component';

export const routes: Routes = [
  // Teacher sign-in pages (no admin sign-up exists)
  {
    path: 'teacher/login',
    canActivate: [teacherGuestGuard],
    title: 'Sign in · AcadSync Teacher',
    loadComponent: () =>
      import('./pages/teacher/login/teacher-login.component').then((m) => m.TeacherLoginComponent),
  },
  {
    path: 'teacher/create-account',
    canActivate: [teacherGuestGuard],
    title: 'Create Account · AcadSync Teacher',
    loadComponent: () =>
      import('./pages/teacher/create-account/create-account.component').then(
        (m) => m.TeacherCreateAccountComponent,
      ),
  },
  {
    path: 'teacher/forgot-password',
    canActivate: [teacherGuestGuard],
    title: 'Forgot password · AcadSync Teacher',
    loadComponent: () =>
      import('./pages/teacher/forgot-password/teacher-forgot-password.component').then(
        (m) => m.TeacherForgotPasswordComponent,
      ),
  },
  {
    path: 'teacher/reset-password',
    canActivate: [teacherGuestGuard],
    title: 'Reset password · AcadSync Teacher',
    loadComponent: () =>
      import('./pages/teacher/reset-password/teacher-reset-password.component').then(
        (m) => m.TeacherResetPasswordComponent,
      ),
  },
  // Teacher portal (its own layout and its own session)
  {
    path: 'teacher',
    component: TeacherLayoutComponent,
    canActivate: [teacherGuard],
    children: [
      { path: '', redirectTo: 'dashboard', pathMatch: 'full' },
      {
        path: 'dashboard',
        title: 'Dashboard · AcadSync Teacher',
        loadComponent: () =>
          import('./pages/teacher/dashboard/teacher-dashboard.component').then(
            (m) => m.TeacherDashboardComponent,
          ),
      },
      {
        path: 'classes',
        title: 'Classes & Sections · AcadSync Teacher',
        loadComponent: () =>
          import('./pages/teacher/classes/classes.component').then(
            (m) => m.TeacherClassesComponent,
          ),
      },
      {
        path: 'schedules',
        title: 'Schedules · AcadSync Teacher',
        loadComponent: () =>
          import('./pages/teacher/schedules/schedules.component').then(
            (m) => m.TeacherSchedulesComponent,
          ),
      },
      {
        path: 'attendance',
        title: 'Attendance · AcadSync Teacher',
        loadComponent: () =>
          import('./pages/teacher/attendance/attendance.component').then(
            (m) => m.TeacherAttendanceComponent,
          ),
      },
      {
        path: 'grades',
        title: 'Grades · AcadSync Teacher',
        // Leaving with unsaved scores asks first, here and in the
        // browser's own leave-page prompt (see the component).
        canDeactivate: [
          (component: { hasUnsavedChanges: () => boolean }) =>
            !component.hasUnsavedChanges() ||
            window.confirm('You have unsaved scores on this page. Leave without saving them?'),
        ],
        loadComponent: () =>
          import('./pages/teacher/grades/grades.component').then(
            (m) => m.TeacherGradesComponent,
          ),
      },
      {
        path: 'consolidation',
        title: 'Academic Consolidation · AcadSync Teacher',
        loadComponent: () =>
          import('./pages/teacher/consolidation/consolidation.component').then(
            (m) => m.TeacherConsolidationComponent,
          ),
      },
      {
        path: 'report-card',
        title: 'Report Card · AcadSync Teacher',
        loadComponent: () =>
          import('./pages/teacher/report-card/report-card.component').then(
            (m) => m.TeacherReportCardComponent,
          ),
      },
      {
        path: 'payments',
        title: 'Payments & Invoices · AcadSync Teacher',
        loadComponent: () =>
          import('./pages/teacher/payments/teacher-payments.component').then(
            (m) => m.TeacherPaymentsComponent,
          ),
      },
      {
        path: 'profile',
        title: 'Profile · AcadSync Teacher',
        loadComponent: () =>
          import('./pages/teacher/profile/teacher-profile.component').then(
            (m) => m.TeacherProfileComponent,
          ),
      },
    ],
  },
  // Sign-in pages (no admin sign-up exists)
  {
    path: 'login',
    canActivate: [guestGuard],
    title: 'Sign in · AcadSync Admin',
    loadComponent: () => import('./pages/login/login.component').then((m) => m.LoginComponent),
  },
  {
    path: 'forgot-password',
    title: 'Forgot password · AcadSync Admin',
    loadComponent: () =>
      import('./pages/forgot-password/forgot-password.component').then(
        (m) => m.ForgotPasswordComponent,
      ),
  },
  {
    path: 'reset-password',
    title: 'Reset password · AcadSync Admin',
    loadComponent: () =>
      import('./pages/reset-password/reset-password.component').then(
        (m) => m.ResetPasswordComponent,
      ),
  },

  // Admin pages (Super User and Admin only)
  {
    path: '',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./layout/admin-layout.component').then((m) => m.AdminLayoutComponent),
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'overview' },
      {
        path: 'overview',
        title: 'Overview · AcadSync Admin',
        loadComponent: () =>
          import('./pages/overview/overview.component').then((m) => m.OverviewComponent),
      },
      {
        path: 'teachers',
        title: 'Teachers · AcadSync Admin',
        loadComponent: () =>
          import('./pages/teachers/teachers.component').then((m) => m.TeachersComponent),
      },
      {
        path: 'teachers/:id',
        title: 'Teacher profile · AcadSync Admin',
        loadComponent: () =>
          import('./pages/teacher-profile/teacher-profile.component').then(
            (m) => m.TeacherProfileComponent,
          ),
      },
      {
        path: 'schools',
        title: 'Schools · AcadSync Admin',
        loadComponent: () =>
          import('./pages/schools/schools.component').then((m) => m.SchoolsComponent),
      },
      {
        path: 'subscriptions',
        title: 'Subscriptions · AcadSync Admin',
        loadComponent: () =>
          import('./pages/subscriptions/subscriptions.component').then(
            (m) => m.SubscriptionsComponent,
          ),
      },
      {
        path: 'subscriptions/:id',
        title: 'Subscription · AcadSync Admin',
        loadComponent: () =>
          import('./pages/subscription-detail/subscription-detail.component').then(
            (m) => m.SubscriptionDetailComponent,
          ),
      },
      {
        path: 'payments',
        title: 'Payments & Invoices · AcadSync Admin',
        loadComponent: () =>
          import('./pages/payments/payments.component').then((m) => m.PaymentsComponent),
      },
      {
        path: 'plans',
        title: 'Plans & Packages · AcadSync Admin',
        loadComponent: () => import('./pages/plans/plans.component').then((m) => m.PlansComponent),
      },
      {
        path: 'reports',
        title: 'Reports · AcadSync Admin',
        loadComponent: () =>
          import('./pages/reports/reports.component').then((m) => m.ReportsComponent),
      },
      {
        path: 'announcements',
        title: 'Announcements · AcadSync Admin',
        loadComponent: () =>
          import('./pages/announcements/announcements.component').then(
            (m) => m.AnnouncementsComponent,
          ),
      },
      {
        path: 'activity',
        title: 'Activity log · AcadSync Admin',
        loadComponent: () =>
          import('./pages/activity/activity.component').then((m) => m.ActivityComponent),
      },
      {
        path: 'settings',
        title: 'Settings · AcadSync Admin',
        loadComponent: () =>
          import('./pages/settings/settings.component').then((m) => m.SettingsComponent),
      },
    ],
  },

  { path: '**', redirectTo: '' },
];
