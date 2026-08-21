'use strict';

define([
  'angular'
], function (angular) {
  angular.module('cedar.templateEditor.service.ceeDirtyTrackerService', [])
      .service('CeeDirtyTrackerService', CeeDirtyTrackerService);

  function CeeDirtyTrackerService() {
    var cleanMetadata = null;

    this.reset = function () {
      cleanMetadata = null;
    };

    this.markClean = function (metadata) {
      cleanMetadata = angular.copy(metadata);
    };

    this.hasBaseline = function () {
      return cleanMetadata !== null;
    };

    this.isDirty = function (metadata) {
      return cleanMetadata !== null && !angular.equals(cleanMetadata, metadata);
    };
  }
});
