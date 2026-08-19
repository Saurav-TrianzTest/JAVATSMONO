import { Component } from '@angular/core';
// Angular Universal component with no isPlatformBrowser/PLATFORM_ID guard
@Component({ selector: 'app-root', template: '' })
export class AppComponent {
  ngOnInit(): void {
    const width = window.innerWidth;
  }
}
