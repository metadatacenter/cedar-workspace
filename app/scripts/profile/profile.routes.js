define([
  'angular'
], function (angular) {
  angular.module('cedar.templateEditor.profile.routes', [])
      .config(profileRoutes);

  profileRoutes.$inject = ['$routeProvider'];

  function profileRoutes($routeProvider) {
    $routeProvider
        .when('/logout', {
          templateUrl: 'scripts/profile/logout.html',
          controller : 'LogoutController'
        })
        .when('/profile', {
          template: '<p>Opening Profile…</p>',
          controller: ['$window', function ($window) { $window.location.reload(); }]
        })
        .when('/privacy', {
          templateUrl: 'scripts/profile/privacy.html',
          controller : 'PrivacyController'
        })
        .when('/settings', {
          templateUrl: 'scripts/profile/settings.html',
          controller : 'SettingsController'
        });
  }

});
