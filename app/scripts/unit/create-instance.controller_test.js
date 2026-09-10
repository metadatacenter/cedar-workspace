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
    var uiUtilService;
    var ceeDirty;
    var createdInstance;
    var $window;
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
        updateTemplateInstance: jasmine.createSpy('updateTemplateInstance').and.callFake(
            function (id, metadata) {
              return {kind: 'update', id: id, metadata: metadata};
            })
      };
      uiUtilService = {setDirty: jasmine.createSpy('setDirty'), setLocked: angular.noop};
      ceeDirty = true;

      // What the server returns from the create: the same metadata as an artifact, with the
      // identifier and the validator every later save is made under.
      createdInstance = {
        '@id': 'instance-9',
        'schema:isBasedOn': 'template-1',
        'schema:name': 'Template metadata',
        $$cedarEtag: '"1"'
      };
      $window = {
        document: {querySelector: function () { return cee; }},
        history: {replaceState: jasmine.createSpy('replaceState')},
        location: {assign: jasmine.createSpy('assign')}
      };

      vm = $controller('CreateInstanceController', {
        $rootScope: $rootScope,
        $routeParams: {templateId: 'template-1'},
        $timeout: $timeout,
        $translate: {instant: function (key) { return key === 'GENERATEDVALUE.instanceTitle' ? ' metadata' : ''; }},
        $window: $window,
        AuthorizedBackendService: {
          doCall: function (request, success) {
            if (request.kind === 'template') {
              success({data: {'schema:name': 'Template'}});
            } else if (request.kind === 'save') {
              success({data: createdInstance});
            } else if (request.kind === 'update') {
              success({data: request.metadata});
            }
          }
        },
        CedarUser: {getHomeFolderId: function () { return 'home'; }},
        CeeConfigService: {getConfig: function () { return {}; }},
        CeeDirtyTrackerService: {
          reset: angular.noop,
          markClean: angular.noop,
          hasBaseline: function () { return true; },
          isDirty: function () { return ceeDirty; }
        },
        CONST: {pageId: {RUNTIME: 'runtime'}, resourceType: {INSTANCE: 'instance'}},
        FrontendUrlService: {
          decodeRouteIdentifier: function (value) { return value; },
          getWorkspaceReturn: function () { return '/dashboard'; },
          getInstanceEdit: function (id) { return '/instances/edit/' + id; }
        },
        HeaderService: {configure: angular.noop},
        QueryParamUtilsService: {
          getFolderId: function () { return 'folder'; },
          getReturnTo: function () { return null; }
        },
        resourceService: {},
        TemplateInstanceService: templateInstanceService,
        TemplateService: {getTemplate: function () { return {kind: 'template'}; }},
        UIMessageService: {flashSuccess: angular.noop, flashAfterReload: angular.noop},
        UIUtilService: uiUtilService
      });

      $timeout.flush();
    }));

    // An edit view over a saved instance, with the CEE returning a serialized copy on save.
    function editSetup() {
      var loadedInstance = {
        '@id': 'instance-1',
        'schema:isBasedOn': 'template-1',
        'schema:name': 'Saved instance',
        $$cedarEtag: '"7"'
      };
      var editCee = {
        currentMetadata: {
          '@id': 'instance-1',
          'schema:isBasedOn': 'template-1',
          'schema:name': 'Edited instance'
        },
        dataQualityReport: {problems: [], isValid: true},
        addEventListener: angular.noop
      };
      var editService = {
        getTemplateInstance: function () { return {kind: 'instance'}; },
        updateTemplateInstance: jasmine.createSpy('updateTemplateInstance').and.callFake(
            function (id, metadata) {
              return {kind: 'update', id: id, metadata: metadata};
            })
      };
      var editVm = $controller('CreateInstanceController', {
        $rootScope: $rootScope,
        $routeParams: {id: 'instance-1'},
        $timeout: $timeout,
        $translate: {instant: function () { return ''; }},
        $window: {
          document: {querySelector: function () { return editCee; }},
          location: {assign: jasmine.createSpy('assign')}
        },
        AuthorizedBackendService: {
          doCall: function (request, success) {
            if (request.kind === 'instance') {
              success({data: loadedInstance});
            } else if (request.kind === 'template') {
              success({data: {'schema:name': 'Template'}});
            } else if (request.kind === 'update') {
              success({data: request.metadata});
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
        resourceService: {
          getResourceDetailFromId: function (id, type, success) { success({}); },
          canEdit: function () { return true; }
        },
        TemplateInstanceService: editService,
        TemplateService: {getTemplate: function () { return {kind: 'template'}; }},
        UIMessageService: {flashSuccess: angular.noop},
        UIUtilService: {setDirty: angular.noop, setLocked: angular.noop}
      });
      $timeout.flush();
      return {cee: editCee, service: editService, vm: editVm};
    }

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

    it('preserves the loaded ETag when CEE returns a serialized copy for update', function () {
      var edit = editSetup();

      edit.vm.save();

      expect(edit.cee.currentMetadata.$$cedarEtag).toBeUndefined();
      expect(edit.service.updateTemplateInstance).toHaveBeenCalledWith(
          'instance-1', jasmine.objectContaining({$$cedarEtag: '"7"'}));
    });

    it('starts new metadata from the generated name and saves it under the typed one', function () {
      expect(vm.instanceName).toBe('Template metadata');

      vm.instanceName = 'Asthma cohort, run 7';
      vm.save();

      expect(templateInstanceService.saveTemplateInstance).toHaveBeenCalledWith(
          'folder', jasmine.objectContaining({'schema:name': 'Asthma cohort, run 7'}));
    });

    it('falls back to the generated name when the field is blank', function () {
      vm.instanceName = '   ';
      vm.save();

      expect(templateInstanceService.saveTemplateInstance).toHaveBeenCalledWith(
          'folder', jasmine.objectContaining({'schema:name': 'Template metadata'}));
    });

    it('counts a changed name as unsaved work, on its own and alongside a clean editor', function () {
      uiUtilService.setDirty.calls.reset();
      vm.instanceName = 'Template metadata';
      vm.instanceNameChanged();
      expect(uiUtilService.setDirty).not.toHaveBeenCalled();

      vm.instanceName = 'Something else';
      vm.instanceNameChanged();
      expect(uiUtilService.setDirty).toHaveBeenCalledWith(true);

      uiUtilService.setDirty.calls.reset();
      ceeDirty = false;
      changeListener({detail: {}});
      expect(uiUtilService.setDirty).toHaveBeenCalledWith(true);
    });

    it('names the metadata in the bar above as the field is typed, not only once saved', function () {
      vm.instanceName = 'Asthma cohort, run 7';
      vm.instanceNameChanged();

      expect($rootScope.documentTitle).toBe('Asthma cohort, run 7');
    });

    it('shows the name an empty field would save rather than an empty bar', function () {
      vm.instanceName = '   ';
      vm.instanceNameChanged();

      expect($rootScope.documentTitle).toBe('Template metadata');
    });

    it('stays on the page when the first save stores the metadata', function () {
      vm.save();

      expect($window.location.assign).not.toHaveBeenCalled();
      // The address a reload or a bookmark would use, so the page it lands on is the saved
      // metadata rather than a create form for metadata that now exists.
      expect($window.history.replaceState).toHaveBeenCalledWith(null, '', '/instances/edit/instance-9');
    });

    it('updates what it created on the next save, under the identifier the server assigned', function () {
      vm.save();
      vm.save();

      // The editor is never handed the stored artifact, so its copy still carries no identifier.
      expect(cee.currentMetadata['@id']).toBeUndefined();
      expect(templateInstanceService.saveTemplateInstance.calls.count()).toBe(1);
      expect(templateInstanceService.updateTemplateInstance).toHaveBeenCalledWith(
          'instance-9', jasmine.objectContaining({'@id': 'instance-9', $$cedarEtag: '"1"'}));
    });

    it('loads the edit address when the browser refuses to rewrite it', function () {
      $window.history.replaceState.and.throwError('cross-origin');

      vm.save();

      expect($window.location.assign).toHaveBeenCalledWith('/instances/edit/instance-9');
    });

    it('loads the saved name for editing and updates under the edited one', function () {
      var edit = editSetup();
      expect(edit.vm.instanceName).toBe('Saved instance');

      edit.vm.instanceName = 'Renamed instance';
      edit.vm.save();

      expect(edit.service.updateTemplateInstance).toHaveBeenCalledWith(
          'instance-1', jasmine.objectContaining({'schema:name': 'Renamed instance'}));
      expect($rootScope.documentTitle).toBe('Renamed instance');
    });
  });
});
