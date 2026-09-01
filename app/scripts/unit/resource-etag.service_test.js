'use strict';

define([
  'angular',
  'angularMocks',
  'cedar/template-editor/service/http-builder.service',
  'cedar/template-editor/service/resource.service'
], function () {

  describe('resourceService concurrency requests:', function () {
    var service;
    var backend;
    var requests;

    beforeEach(module('cedar.templateEditor.service.httpBuilderService'));
    beforeEach(module('cedar.templateEditor.service.resourceService', function ($provide) {
      requests = [];
      backend = {
        doCall: function (request, success) {
          requests.push(request);
          if (request.method === 'GET' && request.url === '/template/one') {
            success({data: {'@id': 'one', $$cedarEtag: '"4"'}});
          } else if (request.method === 'GET' && request.url === '/template/one/details') {
            success({data: {'@id': 'one', $$cedarEtag: '"13"'}});
          } else if (request.method === 'GET' && request.url === '/folder/folder-one') {
            success({data: {'@id': 'folder-one', $$cedarEtag: '"21"'}});
          } else if (request.method === 'GET' && request.url === '/group/one/users') {
            success({data: {users: [], $$cedarEtag: '"8"'}});
          } else {
            success({data: {}});
          }
        }
      };
      $provide.value('AuthorizedBackendService', backend);
      $provide.value('UISettingsService', {});
      $provide.value('UIUtilService', {});
      $provide.value('DataManipulationService', {});
      $provide.value('CedarUser', {});
      $provide.value('UrlService', {
        getTemplate: function () { return '/template/one'; },
        folders: function () { return '/folder'; },
        templatePermission: function () { return '/template/one/permissions'; },
        getGroup: function () { return '/group/one'; },
        getGroupMembers: function () { return '/group/one/users'; },
        renameNode: function () { return '/command/rename-resource'; },
        moveNodeToFolder: function () { return '/command/move-resource-to-folder'; },
        makeArtifactOpen: function () { return '/command/make-artifact-open'; },
        makeArtifactNotOpen: function () { return '/command/make-artifact-not-open'; },
        makeFolderOpen: function () { return '/command/make-folder-open'; },
        makeFolderNotOpen: function () { return '/command/make-folder-not-open'; }
      });
      $provide.value('CONST', {
        resourceType: {TEMPLATE: 'template', FOLDER: 'folder', FIELD: 'field', ELEMENT: 'element', INSTANCE: 'instance'}
      });
    }));

    beforeEach(inject(function (_resourceService_) {
      service = _resourceService_;
    }));

    it('reads a listing resource before issuing its conditional DELETE', function () {
      service.deleteResource({'@id': 'one', resourceType: 'template'}, angular.noop, angular.noop);
      expect(requests.length).toBe(2);
      expect(requests[0].method).toBe('GET');
      expect(requests[1].method).toBe('DELETE');
      expect(requests[1].cedarArtifact.$$cedarEtag).toBe('"4"');
    });

    it('keeps permission, group, and membership validators on their own representations', function () {
      var permissions = {owner: {}, $$cedarEtag: '"5"'};
      service.setResourceShare({'@id': 'one', resourceType: 'template'}, permissions,
          angular.noop, angular.noop);
      expect(requests.pop().cedarArtifact).toBe(permissions);

      var group = {'@id': 'one', 'schema:name': 'Group', $$cedarEtag: '"7"'};
      service.updateGroup(group, angular.noop, angular.noop);
      expect(requests.pop().cedarArtifact).toBe(group);
      service.getGroupMembers(group, angular.noop, angular.noop);
      expect(group.$$cedarMembershipEtag).toBe('"8"');
      service.updateGroupMembers(group, angular.noop, angular.noop);
      expect(requests.pop().cedarArtifact.$$cedarEtag).toBe('"8"');
      service.deleteGroup(group, angular.noop, angular.noop);
      expect(requests.pop().cedarArtifact).toBe(group);
    });

    it('puts the loaded validator on the folder rename command', function () {
      var request = service.renameNode({
        '@id': 'folder-one', resourceType: 'folder', $$cedarEtag: '"12"'
      }, 'Renamed', null);
      expect(request.method).toBe('POST');
      expect(request.headers['If-Match']).toBe('"12"');
    });

    it('reads the graph details validator before each OpenView visibility command', function () {
      var artifact = {'@id': 'one', resourceType: 'template'};
      service.makeArtifactOpen(artifact, angular.noop, angular.noop);
      expect(requests[requests.length - 2].url).toBe('/template/one/details');
      expect(requests[requests.length - 1].headers['If-Match']).toBe('"13"');

      service.makeArtifactNotOpen(artifact, angular.noop, angular.noop);
      expect(requests[requests.length - 2].url).toBe('/template/one/details');
      expect(requests[requests.length - 1].headers['If-Match']).toBe('"13"');

      var folder = {'@id': 'folder-one', resourceType: 'folder'};
      service.makeFolderOpen(folder, angular.noop, angular.noop);
      expect(requests[requests.length - 2].url).toBe('/folder/folder-one');
      expect(requests[requests.length - 1].headers['If-Match']).toBe('"21"');

      service.makeFolderNotOpen(folder, angular.noop, angular.noop);
      expect(requests[requests.length - 2].url).toBe('/folder/folder-one');
      expect(requests[requests.length - 1].headers['If-Match']).toBe('"21"');
    });

    it('reads the graph details validator before moving a resource', function () {
      service.moveResource({'@id': 'one', resourceType: 'template'}, 'destination',
          angular.noop, angular.noop);
      expect(requests[requests.length - 2].url).toBe('/template/one/details');
      expect(requests[requests.length - 1].url).toBe('/command/move-resource-to-folder');
      expect(requests[requests.length - 1].headers['If-Match']).toBe('"13"');
    });
  });
});
