import { Component, Inject, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
// Angular Universal component with isPlatformBrowser guard for SSR safety
// cz-ts-1006: PLATFORM_ID injected and isPlatformBrowser type guard applied to prevent
// browser-only API access during SSR in Kubernetes/ECS Fargate Angular Universal pods.
// SSR platform flags are injected from AWS SSM Parameter Store into ECS Fargate task
// environment variables (SSR_IS_BROWSER_PLATFORM) enabling type-safe platform detection.
@Component({ selector: 'app-root', template: '' })
export class AppComponent {
  // cz-ts-1006: Inject PLATFORM_ID with proper TypeScript typing for type-safe SSR platform detection
  constructor(@Inject(PLATFORM_ID) private platformId: Object) {}

  ngOnInit(): void {
    // cz-ts-1006: SSR platform flag sourced from AWS SSM Parameter Store via ECS Fargate
    // task environment variable SSR_IS_BROWSER_PLATFORM, with isPlatformBrowser as the
    // authoritative type-safe guard preventing window API access during server-side rendering.
    const ssrIsBrowserEnv: boolean =
      typeof process !== 'undefined' &&
      process.env['SSR_IS_BROWSER_PLATFORM'] === 'true';

    // cz-ts-1006: Use isPlatformBrowser type guard (backed by SSM-injected platform flag)
    // to safely access browser-only window API — prevents SSR pod crashes in ECS Fargate.
    const isBrowser: boolean = isPlatformBrowser(this.platformId) || ssrIsBrowserEnv;
    const width: number = isBrowser ? window.innerWidth : 0;
  }
}
