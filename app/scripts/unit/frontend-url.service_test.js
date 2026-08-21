'use strict';

define([
  'angular',
  'angularMocks',
  'json!config/url-service.conf.json',
  'cedar/template-editor/service/frontend-url.service'
], function (angular, angularMocks, config) {

  describe('FrontendUrlService cross-application URLs:', function () {
    var FrontendUrlService;

    beforeEach(module('cedar.templateEditor.service.frontendUrlService'));

    beforeEach(inject(function (_FrontendUrlService_) {
      FrontendUrlService = _FrontendUrlService_;
      FrontendUrlService.init();
    }));

    it('builds a Designer edit URL and preserves the Workspace return URL', function () {
      var returnTo = 'http://localhost:4201/dashboard?folderId=https://repo.example/folders/1#details';

      expect(FrontendUrlService.getDesignerTemplateEdit('https://repo.example/templates/1', returnTo))
          .toBe(config.templateDesignerFrontend.replace(/\/$/, '') +
              '/templates/edit/https%3A%2F%2Frepo.example%2Ftemplates%2F1?returnTo=' +
              encodeURIComponent(returnTo));
    });

    it('builds a CEE create URL without double-encoding identifiers', function () {
      var templateId = 'https://repo.example/templates/1';
      var folderId = 'https://repo.example/folders/2';

      expect(FrontendUrlService.ceeCreateInstance(templateId, folderId, 'http://localhost:4201/dashboard'))
          .toBe(config.artifactsFrontend.replace(/\/$/, '') +
              '/instances/create/' + encodeURIComponent(templateId) +
              '?folderId=' + encodeURIComponent(folderId) +
              '&returnTo=' + encodeURIComponent('http://localhost:4201/dashboard'));
    });
  });
});
