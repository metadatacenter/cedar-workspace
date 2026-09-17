'use strict';
define(['angular', 'angularMocks', 'lib/angular-route/angular-route.min', 'cedar/template-editor/template-instance/template-instance.routes'], function () {
  describe('Metadata route handoff', function () {
    beforeEach(module('ngRoute'));
    beforeEach(module('cedar.templateEditor.templateInstance.routes'));
    ['/instances/create/:templateId*?', '/instances/edit/:id*'].forEach(function (path) {
      it('reloads ' + path + ' into the modern entry point', inject(function ($route, $controller) {
        var reload = jasmine.createSpy('reload');
        $controller($route.routes[path].controller, {$window: {location: {reload: reload}}});
        expect(reload).toHaveBeenCalled();
      }));
    });
  });
});
