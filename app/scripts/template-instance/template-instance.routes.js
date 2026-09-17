'use strict';
define(['angular'], function (angular) {
  angular.module('cedar.templateEditor.templateInstance.routes', [])
    .config(['$routeProvider', function ($routeProvider) {
      var handoff = {
        template: '<p role="status">Opening metadata editor…</p>',
        controller: ['$window', function ($window) { $window.location.reload(); }]
      };
      $routeProvider.when('/instances/create/:templateId*?', handoff)
        .when('/instances/edit/:id*', handoff);
    }]);
});
