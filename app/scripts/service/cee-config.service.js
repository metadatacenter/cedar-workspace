'use strict';

define([
  'angular',
  'json!config/embeddable-editor-config.json'
], function (angular, config) {
  angular.module('cedar.templateEditor.service.ceeConfigService', [])
      .service('CeeConfigService', CeeConfigService);

  function CeeConfigService() {
    this.getConfig = function () {
      return config;
    };
  }
});
