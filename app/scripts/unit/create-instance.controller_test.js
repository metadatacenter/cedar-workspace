'use strict';

define([
  'angular',
  'angularMocks',
  'cedar/template-editor/template-instance/create-instance.controller'
], function () {

  describe('CreateInstanceController CEE validation report:', function () {
    var $controller;
    var $rootScope;
    var $timeout;
    var cee;
    var changeListener;
    var templateInstanceService;
    var vm;

    beforeEach(module('cedar.templateEditor.templateInstance.createInstanceController'));

    beforeEach(inject(function (_$controller_, _$rootScope_, _$timeout_) {
      $controller = _$controller_;
      $rootScope = _$rootScope_;
      $timeout = _$timeout_;

      cee = {
        currentMetadata: {'schema:name': 'Example'},
        dataQualityReport: {
          requiredFieldValueCount: 2,
          nonNullRequiredFieldValueCount: 1,
          problems: [],
          isValid: false
        },
        addEventListener: function (name, listener) {
          if (name === 'change') {
            changeListener = listener;
          }
        }
      };
      templateInstanceService = {
        saveTemplateInstance: jasmine.createSpy('saveTemplateInstance').and.returnValue({kind: 'save'}),
        updateTemplateInstance: jasmine.createSpy('updateTemplateInstance')
      };

      vm = $controller('CreateInstanceController', {
        $rootScope: $rootScope,
        $routeParams: {templateId: 'template-1'},
        $timeout: $timeout,
        $translate: {instant: function () { return ''; }},
        $window: {
          document: {querySelector: function () { return cee; }},
          location: {assign: jasmine.createSpy('assign')}
        },
        AuthorizedBackendService: {
          doCall: function (request, success) {
            if (request.kind === 'template') {
              success({data: {'schema:name': 'Template'}});
            }
          }
        },
        CedarUser: {getHomeFolderId: function () { return 'home'; }},
        CeeConfigService: {getConfig: function () { return {}; }},
        CeeDirtyTrackerService: {
          reset: angular.noop,
          markClean: angular.noop,
          hasBaseline: function () { return true; },
          isDirty: function () { return true; }
        },
        CONST: {pageId: {RUNTIME: 'runtime'}, resourceType: {INSTANCE: 'instance'}},
        FrontendUrlService: {
          decodeRouteIdentifier: function (value) { return value; },
          getWorkspaceReturn: function () { return '/dashboard'; },
          getInstanceEdit: function () { return '/instances/edit/1'; }
        },
        HeaderService: {configure: angular.noop},
        QueryParamUtilsService: {
          getFolderId: function () { return 'folder'; },
          getReturnTo: function () { return null; }
        },
        resourceService: {},
        TemplateInstanceService: templateInstanceService,
        TemplateService: {getTemplate: function () { return {kind: 'template'}; }},
        UIMessageService: {},
        UIUtilService: {setDirty: angular.noop, setLocked: angular.noop}
      });

      $timeout.flush();
    }));

    it('shows the initial invalid report, including the counter fallback when no problem paths are available', function () {
      expect(vm.showValidationReport()).toBe(true);
      expect(vm.missingRequiredFieldCount).toBe(1);
      expect(vm.missingRequiredFieldMessage).toBe('1 required field is missing.');
      expect(vm.validationProblems).toEqual([]);
      expect(vm.saveButtonDisabled).toBe(false);
    });

    it('updates paths and messages from the report carried by a CEE change event', function () {
      var problem = {
        path: ['_author', '_email'],
        field: '_email',
        code: 'required',
        message: 'A required value is missing.',
        value: null
      };

      changeListener({detail: {dataQualityReport: {
        requiredFieldValueCount: 1,
        nonNullRequiredFieldValueCount: 0,
        problems: [problem],
        isValid: false
      }}});
      $rootScope.$digest();

      expect(vm.validationProblems).toEqual([problem]);
      expect(vm.problemPath(problem)).toBe('_author / _email');
      expect(vm.saveButtonDisabled).toBe(false);
    });

    it('does not use validation errors to prohibit save', function () {
      vm.save();

      expect(templateInstanceService.saveTemplateInstance).toHaveBeenCalled();
    });
  });
});
