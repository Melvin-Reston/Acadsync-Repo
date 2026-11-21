// Route guards: who may open which page.
import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { catchError, map, of } from 'rxjs';
import { AuthService } from './auth.service';

// Admin pages: only for a signed-in Super User or Admin.
export const authGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  const router = inject(Router);

  if (!auth.token) {
    return router.createUrlTree(['/login']);
  }
  if (auth.admin()) {
    return true;
  }

  // A token is saved but the page was refreshed: check it with the API.
  return auth.loadCurrentAdmin().pipe(
    map(() => true),
    catchError(() => of(router.createUrlTree(['/login']))),
  );
};

// Sign-in pages: someone who is already signed in goes straight to the overview.
export const guestGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  const router = inject(Router);
  return auth.token ? router.createUrlTree(['/overview']) : true;
};

// Pages only the Super User may open. Use after authGuard.
export const superUserGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  const router = inject(Router);
  return auth.isSuperUser() ? true : router.createUrlTree(['/overview']);
};
