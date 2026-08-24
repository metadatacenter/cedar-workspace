'use strict';

define([
  'angular'
], function (angular) {
  angular.module('cedar.templateEditor.templateInstance.createInstanceController', [])
      .controller('CreateInstanceController', CreateInstanceController);

  CreateInstanceController.$inject = [
    '$rootScope', '$routeParams', '$timeout', '$translate', '$window',
    'AuthorizedBackendService', 'CedarUser', 'CeeConfigService', 'CeeDirtyTrackerService',
    'CONST', 'FrontendUrlService', 'HeaderService', 'QueryParamUtilsService', 'resourceService',
    'TemplateInstanceService', 'TemplateService', 'UIMessageService', 'UIUtilService'
  ];

  function CreateInstanceController($rootScope, $routeParams, $timeout, $translate, $window,
                                    AuthorizedBackendService, CedarUser, CeeConfigService,
                                    CeeDirtyTrackerService, CONST, FrontendUrlService, HeaderService,
                                    QueryParamUtilsService, resourceService, TemplateInstanceService,
                                    TemplateService, UIMessageService, UIUtilService) {
    var vm = this;
    var form = null;
    var instance = null;
    var cee = null;

    vm.loading = true;
    vm.canWrite = true;
    vm.saveButtonDisabled = false;
    vm.validationReport = null;
    vm.validationProblems = [];
    vm.missingRequiredFieldCount = 0;
    vm.missingRequiredFieldMessage = '';

    function updateValidationReport(report) {
      var requiredCount;
      var completedRequiredCount;

      vm.validationReport = report && typeof report === 'object' ? report : null;
      vm.validationProblems = vm.validationReport && angular.isArray(vm.validationReport.problems) ?
          vm.validationReport.problems : [];
      requiredCount = vm.validationReport && angular.isNumber(vm.validationReport.requiredFieldValueCount) ?
          vm.validationReport.requiredFieldValueCount : 0;
      completedRequiredCount = vm.validationReport &&
          angular.isNumber(vm.validationReport.nonNullRequiredFieldValueCount) ?
          vm.validationReport.nonNullRequiredFieldValueCount : 0;
      vm.missingRequiredFieldCount = Math.max(0, requiredCount - completedRequiredCount);
      vm.missingRequiredFieldMessage = vm.missingRequiredFieldCount === 1 ?
          '1 required field is missing.' : vm.missingRequiredFieldCount + ' required fields are missing.';
    }

    vm.showValidationReport = function () {
      return vm.validationReport !== null && vm.validationReport.isValid === false;
    };

    vm.problemPath = function (problem) {
      if (problem && angular.isArray(problem.path) && problem.path.length > 0) {
        return problem.path.join(' / ');
      }
      return problem && problem.field ? problem.field : 'Metadata';
    };

    function showLoadError(messageKey, error) {
      UIMessageService.showBackendError(messageKey, error);
      UIUtilService.setDirty(false);
      $window.location.assign(FrontendUrlService.getWorkspaceReturn(
          QueryParamUtilsService.getReturnTo(), QueryParamUtilsService.getFolderId()));
    }

    function markClean() {
      if (cee) {
        CeeDirtyTrackerService.markClean(cee.currentMetadata);
      }
      UIUtilService.setDirty(false);
    }

    function applyReadOnlyState() {
      if (!cee) {
        return;
      }
      var config = angular.copy(CeeConfigService.getConfig());
      config.readOnlyMode = !vm.canWrite;
      cee.config = config;
      UIUtilService.setLocked(!vm.canWrite);
    }

    function watchForChanges() {
      cee.addEventListener('change', function (event) {
        var report = event && event.detail ? event.detail.dataQualityReport : null;
        updateValidationReport(report || cee.dataQualityReport);
        var dirty = CeeDirtyTrackerService.hasBaseline() ?
            CeeDirtyTrackerService.isDirty(cee.currentMetadata) : true;
        UIUtilService.setDirty(dirty);
        $rootScope.$evalAsync();
      });
    }

    function finishLoad() {
      vm.loading = false;
      updateValidationReport(cee.dataQualityReport);
      $timeout(markClean, 0);
    }

    function loadWritePermission(id) {
      resourceService.getResourceDetailFromId(
          id,
          CONST.resourceType.INSTANCE,
          function (details) {
            vm.canWrite = resourceService.canWrite(details);
            applyReadOnlyState();
          },
          function () {
            vm.canWrite = false;
            applyReadOnlyState();
          }
      );
    }

    function loadTemplate(templateId) {
      AuthorizedBackendService.doCall(
          TemplateService.getTemplate(FrontendUrlService.decodeRouteIdentifier(templateId)),
          function (response) {
            form = response.data;
            $rootScope.documentTitle = form['schema:name'];
            cee.templateObject = form;
            finishLoad();
          },
          function (error) {
            showLoadError('SERVER.TEMPLATE.load.error', error);
          }
      );
    }

    function loadInstance(instanceId) {
      AuthorizedBackendService.doCall(
          TemplateInstanceService.getTemplateInstance(instanceId),
          function (instanceResponse) {
            instance = instanceResponse.data;
            $rootScope.documentTitle = instance['schema:name'];
            loadWritePermission(instance['@id']);

            AuthorizedBackendService.doCall(
                TemplateService.getTemplate(instance['schema:isBasedOn']),
                function (templateResponse) {
                  form = templateResponse.data;
                  cee.templateAndInstanceObject = {
                    templateObject: form,
                    instanceObject: instance
                  };
                  finishLoad();
                },
                function (error) {
                  showLoadError('SERVER.TEMPLATE.load-for-instance.error', error);
                }
            );
          },
          function (error) {
            showLoadError('SERVER.INSTANCE.load.error', error);
          }
      );
    }

    function enableSave() {
      vm.saveButtonDisabled = false;
    }

    function saveCreated(response) {
      markClean();
      UIMessageService.flashAfterReload('success', 'SERVER.INSTANCE.create.success', 'GENERIC.Created');
      $window.location.assign(FrontendUrlService.getInstanceEdit(
          response.data['@id'], QueryParamUtilsService.getFolderId(), QueryParamUtilsService.getReturnTo()));
    }

    function createInstance(metadata) {
      metadata['schema:isBasedOn'] = FrontendUrlService.decodeRouteIdentifier($routeParams.templateId);
      metadata['schema:name'] = metadata['schema:name'] ||
          form['schema:name'] + $translate.instant('GENERATEDVALUE.instanceTitle');
      metadata['schema:description'] = metadata['schema:description'] ||
          form['schema:description'] + $translate.instant('GENERATEDVALUE.instanceDescription');

      var folderId = QueryParamUtilsService.getFolderId() || CedarUser.getHomeFolderId();
      AuthorizedBackendService.doCall(
          TemplateInstanceService.saveTemplateInstance(folderId, metadata),
          saveCreated,
          function (error) {
            UIMessageService.showBackendError('SERVER.INSTANCE.create.error', error);
            enableSave();
          }
      );
    }

    function updateInstance(metadata) {
      AuthorizedBackendService.doCall(
          TemplateInstanceService.updateTemplateInstance(metadata['@id'], metadata),
          function () {
            instance = metadata;
            markClean();
            UIMessageService.flashSuccess('SERVER.INSTANCE.update.success', null, 'GENERIC.Updated');
            enableSave();
          },
          function (error) {
            UIMessageService.showBackendError('SERVER.INSTANCE.update.error', error);
            enableSave();
          }
      );
    }

    vm.save = function () {
      if (!vm.canWrite || !cee || !cee.currentMetadata) {
        return;
      }
      vm.saveButtonDisabled = true;
      var metadata = angular.copy(cee.currentMetadata);
      if (metadata['@id'] == null) {
        createInstance(metadata);
      } else {
        updateInstance(metadata);
      }
    };

    vm.cancel = function () {
      UIUtilService.setDirty(false);
      $window.location.assign(FrontendUrlService.getWorkspaceReturn(
          QueryParamUtilsService.getReturnTo(), QueryParamUtilsService.getFolderId()));
    };

    $rootScope.showSearch = false;
    $rootScope.pageTitle = 'Metadata Editor';
    HeaderService.configure(CONST.pageId.RUNTIME);
    CeeDirtyTrackerService.reset();

    $timeout(function () {
      cee = $window.document.querySelector('cedar-embeddable-editor');
      if (!cee) {
        showLoadError('SERVER.INSTANCE.load.error', new Error('CEDAR Embeddable Editor did not initialize'));
        return;
      }
      applyReadOnlyState();
      watchForChanges();

      if ($routeParams.templateId !== undefined) {
        loadTemplate($routeParams.templateId);
      } else if ($routeParams.id !== undefined) {
        loadInstance(FrontendUrlService.decodeRouteIdentifier($routeParams.id));
      }
    }, 0);
  }
});
