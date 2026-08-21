'use strict';

define([
  'angular',
  'angularMocks',
  'cedar/template-editor/service/query-param-utils.service'
], function () {

  describe('QueryParamUtilsService navigation contract:', function () {
    var QueryParamUtilsService;
    var $location;

    beforeEach(module('cedar.templateEditor.service.queryParamUtilsService'));

    beforeEach(inject(function (_QueryParamUtilsService_, _$location_) {
      QueryParamUtilsService = _QueryParamUtilsService_;
      $location = _$location_;
    }));

    it('returns the complete decoded Workspace return URL', function () {
      var returnTo = 'http://localhost:4201/dashboard?folderId=folder-1#details';
      $location.search('returnTo', returnTo);

      expect(QueryParamUtilsService.getReturnTo()).toBe(returnTo);
    });
  });
});
