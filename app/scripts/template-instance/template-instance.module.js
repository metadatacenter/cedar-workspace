'use strict';

// Legacy ancillary pages may navigate here through ngRoute. Reload so the
// root dispatcher hands metadata routes to the modern Angular CEE host.
define(['angular', 'cedar/template-editor/template-instance/template-instance.routes'], function (angular) {
  angular.module('cedar.templateEditor.templateInstance', ['cedar.templateEditor.templateInstance.routes']);
});
