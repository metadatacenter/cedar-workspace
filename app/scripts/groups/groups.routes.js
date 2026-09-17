'use strict';

define(['angular'], function (angular) {
  angular.module('cedar.templateEditor.groups.routes', [])
      .config(groupsRoutes);

  groupsRoutes.$inject = ['$routeProvider'];

  function groupsRoutes($routeProvider) {
    $routeProvider.when('/groups', {
      template: '<p>Opening Groups…</p>',
      controller: ['$window', function ($window) { $window.location.reload(); }]
    });
  }
});
