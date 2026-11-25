// The frame around every teacher page: numbered sidebar on the left, top bar, then the page.
// Dashboard, Classes & Sections, Schedules, Attendance, Grades, Consolidation, Report Card,
// Quizzes & Exams, Payments & Invoices and Profile are live; Lesson Plans is parked (see the
// routes file) and the other items are marked "Soon" and are not
// links, so nothing pretends to work before its batch arrives.
import { DatePipe } from '@angular/common';
import { Component, OnDestroy, computed, inject, signal } from '@angular/core';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { filter, Subscription } from 'rxjs';
import { initials } from '../core/helpers';
import { TeacherAuthService } from '../core/teacher-auth.service';
import { ThemeService } from '../core/theme.service';
import { ViewingYearService } from '../core/viewing-year.service';
import { IconComponent } from '../shared/icon.component';

interface NavItem {
  number: string;
  label: string;
  path: string | null; // null means "coming in a later batch"
  icon: string;
}

const TITLES: Record<string, string> = {
  '/teacher/dashboard': 'Dashboard · Teacher Portal',
  '/teacher/classes': 'Classes & Sections · Teacher Portal',
  '/teacher/schedules': 'Schedules · Teacher Portal',
  '/teacher/attendance': 'Attendance · Teacher Portal',
  '/teacher/grades': 'Grades · Teacher Portal',
  '/teacher/consolidation': 'Academic Consolidation · Teacher Portal',
  '/teacher/report-card': 'Report Card · Teacher Portal',
  '/teacher/assessments': 'Quizzes & Exams · Teacher Portal',
  '/teacher/quizzes': 'Quizzes & Exams · Teacher Portal',
  '/teacher/exams': 'Quizzes & Exams · Teacher Portal',
  '/teacher/payments': 'Payments & Invoices · Teacher Portal',
  '/teacher/profile': 'Profile · Teacher Portal',
};

@Component({
  selector: 'app-teacher-layout',
  imports: [RouterOutlet, RouterLink, RouterLinkActive, DatePipe, IconComponent],
  templateUrl: './teacher-layout.component.html',
  styleUrl: './teacher-layout.component.css',
})
export class TeacherLayoutComponent implements OnDestroy {
  protected readonly auth = inject(TeacherAuthService);
  protected readonly theme = inject(ThemeService);
  protected readonly year = inject(ViewingYearService);
  private readonly router = inject(Router);
  private readonly routerSubscription: Subscription;

  protected readonly today = new Date();
  protected readonly drawerOpen = signal(false);
  protected readonly pageTitle = signal('Dashboard · Teacher Portal');
  protected readonly currentRoute = signal('/teacher/dashboard');

  protected readonly navGroups: { label: string; items: NavItem[] }[] = [
    {
      label: 'Main',
      items: [
        { number: '01', label: 'Dashboard', path: '/teacher/dashboard', icon: 'grid' },
        { number: '02', label: 'Classes & Sections', path: '/teacher/classes', icon: 'layers' },
        { number: '03', label: 'Schedules', path: '/teacher/schedules', icon: 'list' },
      ],
    },
    {
      label: 'Manage',
      items: [
        { number: '04', label: 'Attendance', path: '/teacher/attendance', icon: 'check' },
        { number: '05', label: 'Grades', path: '/teacher/grades', icon: 'edit' },
        { number: '06', label: 'Consolidation', path: '/teacher/consolidation', icon: 'chart' },
        { number: '07', label: 'Report Card', path: '/teacher/report-card', icon: 'card' },
        { number: '08', label: 'Quizzes & Exams', path: '/teacher/assessments', icon: 'quiz' },
        // Lesson Plans parked 2026-11-25: no sidebar item until it returns.
      ],
    },
    {
      label: 'Account',
      items: [
        { number: '09', label: 'Payments & Invoices', path: '/teacher/payments', icon: 'receipt' },
        { number: '10', label: 'Profile', path: '/teacher/profile', icon: 'users' },
      ],
    },
  ];

  protected readonly initials = initials;

  constructor() {
    // Titles are looked up by path only: the merged Assessments page
    // carries its tab in the address (?tab=exams), which must not
    // change the top-bar title.
    const pathOf = (url: string): string => url.split('?')[0];
    this.pageTitle.set(TITLES[pathOf(this.router.url)] ?? 'Dashboard · Teacher Portal');
    this.currentRoute.set(pathOf(this.router.url));
    this.routerSubscription = this.router.events
      .pipe(filter((event) => event instanceof NavigationEnd))
      .subscribe((event) => {
        const path = pathOf(event.urlAfterRedirects);
        this.pageTitle.set(TITLES[path] ?? 'Teacher Portal');
        this.currentRoute.set(path);
      });
    // Loads the years for the AY filter in the top bar.
    this.year.load();
  }

  ngOnDestroy(): void {
    this.routerSubscription.unsubscribe();
  }

  // The AY filter only belongs on pages that show records for a year.
  // Payments and Profile are the teacher's current account, not a year's records.
  // A computed, so the top bar does not re-derive it on every change-detection run.
  protected readonly showYearFilter = computed(
    () => !['/teacher/payments', '/teacher/profile'].includes(this.currentRoute()),
  );

  protected readonly adviserLine = computed(() => {
    const teacher = this.auth.teacher();
    if (!teacher) return '';
    if (teacher.is_adviser && teacher.advisory_grade && teacher.advisory_section) {
      return `Adviser · G${teacher.advisory_grade} – ${teacher.advisory_section}`;
    }
    return teacher.school_name ?? 'Teacher';
  });

  protected onYearChange(event: Event): void {
    const value = (event.target as HTMLSelectElement).value;
    if (value) this.year.select(value);
  }

  protected closeDrawer(): void {
    this.drawerOpen.set(false);
  }
}
