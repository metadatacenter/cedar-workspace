'use strict';

// Compatibility handoff for in-app navigation from the remaining AngularJS pages.
// The dashboard itself is owned by the standalone Angular workspace.
define(['angular'], function (angular) {
  angular.module('cedar.templateEditor.dashboard.dashboardController', [])
      .controller('DashboardController', ['$window', function ($window) {
        $window.location.reload();
      }]);
});
