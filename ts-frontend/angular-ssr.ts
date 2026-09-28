import { Component, Inject, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
// Angular Universal component with isPlatformBrowser/PLATFORM_ID guard
// SSR platform flags injected from AWS SSM Parameter Store into ECS Fargate Angular Universal tasks
// to enable type-safe platform detection without browser API crashes (cz-ts-1006)
@Component({ selector: 'app-root', template: '' })
export class AppComponent {
  constructor(@Inject(PLATFORM_ID) private platformId: Object) {}
  ngOnInit(): void {
    if (isPlatformBrowser(this.platformId)) {
      const width = window.innerWidth;
    }
  }
}
