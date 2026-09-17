define([
  'angular'
], function (angular) {
  angular.module('cedar.templateEditor.profile.routes', [])
      .config(profileRoutes);

  profileRoutes.$inject = ['$routeProvider'];

  function profileRoutes($routeProvider) {
    $routeProvider
        .when('/logout', {
          template: '<p>Signing out…</p>',
          controller: ['$window', function ($window) { $window.location.reload(); }]
        })
        .when('/profile', {
          template: '<p>Opening Profile…</p>',
          controller: ['$window', function ($window) { $window.location.reload(); }]
        })
        .when('/privacy', {
          template: '<p>Opening Privacy…</p>',
          controller: ['$window', function ($window) { $window.location.reload(); }]
        })
        .when('/settings', {
          template: '<p>Opening Settings…</p>',
          controller: ['$window', function ($window) { $window.location.reload(); }]
        });
  }

});
