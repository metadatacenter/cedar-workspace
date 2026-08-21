'use strict';

define([
  'angular',
  'json!config/url-service.conf.json'
], function (angular, config) {
  angular.module('cedar.templateEditor.service.frontendUrlService', [])
      .service('FrontendUrlService', FrontendUrlService);

  FrontendUrlService.$inject = ['$window'];

  function FrontendUrlService($window) {

    let openViewBase = null;
    let workspaceBase = null;
    let templateDesignerBase = null;
    let dataciteDOIBase = null
    let downloadBase = null
    let monitoringBase = null

    let service = {
      serviceId: "FrontendUrlService"
    };

    service.init = function () {
      openViewBase = config.openViewBase;
      workspaceBase = withoutTrailingSlash(config.workspaceFrontend);
      templateDesignerBase = withoutTrailingSlash(config.templateDesignerFrontend);
      dataciteDOIBase = config.dataciteDOIBase;
      downloadBase = config.downloadBase;
      monitoringBase = config.monitoringFrontend;
    };

    function withoutTrailingSlash(url) {
      return (url || '').replace(/\/$/, '');
    }

    function withQuery(url, params) {
      var query = Object.keys(params || {}).filter(function (key) {
        return params[key] !== null && params[key] !== undefined && params[key] !== '';
      }).map(function (key) {
        return encodeURIComponent(key) + '=' + encodeURIComponent(params[key]);
      }).join('&');
      return query ? url + '?' + query : url;
    }

    function isLoopback(hostname) {
      return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]';
    }

    function isSecureOrLocal(url) {
      return url.protocol === 'https:' || (url.protocol === 'http:' && isLoopback(url.hostname));
    }

    service.decodeRouteIdentifier = function (value) {
      if (value === null || value === undefined) {
        return value;
      }
      var decoded = value;
      try {
        decoded = decodeURIComponent(value);
      } catch (error) {
        // Let the backend reject a malformed identifier instead of crashing the route shell.
      }
      // AngularJS may decode an encoded slash in a path parameter before exposing it,
      // leaving an otherwise valid URL with one slash after the scheme.
      return decoded.replace(/^(https?):\/([^/])/, '$1://$2');
    };

    service.getWorkspaceReturn = function (returnTo, folderId) {
      var configuredWorkspace;
      try {
        configuredWorkspace = new $window.URL(workspaceBase);
      } catch (error) {
        throw new Error('Invalid workspaceFrontend configuration');
      }
      if (!isSecureOrLocal(configuredWorkspace)) {
        throw new Error('workspaceFrontend must use HTTPS except on loopback hosts');
      }

      if (returnTo) {
        try {
          var candidate = new $window.URL(returnTo, configuredWorkspace.href);
          if (candidate.origin === configuredWorkspace.origin && isSecureOrLocal(candidate) &&
              !candidate.username && !candidate.password) {
            return candidate.href;
          }
        } catch (error) {
          // Invalid and cross-origin return URLs deliberately fall through to the safe fallback.
        }
      }
      return withQuery(workspaceBase + '/dashboard', {folderId: folderId});
    };

    service.getTemplateEdit = function (id) {
      return "/templates/edit/" + id;
    };

    service.getElementEdit = function (id) {
      return "/elements/edit/" + id;
    };

    service.getFieldEdit = function (id) {
      return "/fields/edit/" + id;
    };

    service.getDesignerTemplateCreate = function (folderId, returnTo) {
      return withQuery(templateDesignerBase + '/templates/create', {folderId: folderId, returnTo: returnTo});
    };

    service.getDesignerElementCreate = function (folderId, returnTo) {
      return withQuery(templateDesignerBase + '/elements/create', {folderId: folderId, returnTo: returnTo});
    };

    service.getDesignerFieldCreate = function (folderId, returnTo) {
      return withQuery(templateDesignerBase + '/fields/create', {folderId: folderId, returnTo: returnTo});
    };

    service.getDesignerTemplateEdit = function (id, returnTo) {
      return withQuery(templateDesignerBase + '/templates/edit/' + encodeURIComponent(id), {returnTo: returnTo});
    };

    service.getDesignerElementEdit = function (id, returnTo) {
      return withQuery(templateDesignerBase + '/elements/edit/' + encodeURIComponent(id), {returnTo: returnTo});
    };

    service.getDesignerFieldEdit = function (id, returnTo) {
      return withQuery(templateDesignerBase + '/fields/edit/' + encodeURIComponent(id), {returnTo: returnTo});
    };

    service.getInstanceCreate = function (id, folderId) {
      return '/instances/create/' + id + '?folderId=' + encodeURIComponent(folderId);
    };

    service.getInstanceEdit = function (id, folderId, returnTo) {
      return withQuery(workspaceBase + '/instances/edit/' + encodeURIComponent(id), {
        folderId: folderId,
        returnTo: returnTo
      });
    };

    service.getFolderContents = function (folderId) {
      return '/dashboard?folderId=' + encodeURIComponent(folderId);
    };

    service.getMyWorkspace = function () {
      return '/dashboard';
    };

    service.getSearchAll = function (folderId) {
      return '/dashboard?search=*&folderId=' + folderId;
    };

    service.getSharedWithMe = function (folderId) {
      return '/dashboard?sharing=shared-with-me&folderId=' + folderId;
    };

    service.getSpecialFolders = function (folderId) {
      return '/dashboard?viewMode=view-special-folders&folderId=' + folderId;
    };

    service.getSharedWithEverybody = function (folderId) {
      return '/dashboard?sharing=shared-with-everybody&folderId=' + folderId;
    };

    service.getMessaging = function (folderId) {
      return '/messaging?folderId=' + encodeURIComponent(folderId);
    };

    service.openField = function (id) {
      return openViewBase + '/template-fields/' + encodeURIComponent(id);
    };

    service.openElement = function (id) {
      return openViewBase + '/template-elements/' + encodeURIComponent(id);
    };

    service.openTemplate = function (id) {
      return openViewBase + '/templates/' + encodeURIComponent(id);
    };

    service.openInstance = function (id) {
      return openViewBase + '/template-instances/' + encodeURIComponent(id);
    };

    service.openFolder = function (id) {
      return openViewBase + '/folders/' + encodeURIComponent(id);
    };

    service.ceeCreateInstance = function (id, folderId, returnTo) {
      return withQuery(workspaceBase + '/instances/create/' + encodeURIComponent(id), {
        folderId: folderId,
        returnTo: returnTo
      });
    };

    service.ceeEditInstance = function (id, returnTo) {
      return withQuery(workspaceBase + '/instances/edit/' + encodeURIComponent(id), {returnTo: returnTo});
    };

    service.getWorkspaceBase = function () {
      return workspaceBase;
    };

    service.dataciteTemplate = function (id) {
      return dataciteDOIBase + '/' + encodeURIComponent(id);
    };

    service.dataciteInstance = function (id) {
      return dataciteDOIBase + '/' + encodeURIComponent(id);
    };

    service.downloadResource = function (id) {
      return downloadBase + '/' + encodeURIComponent(id);
    };

    // The CEDAR monitoring dashboard: a separate CEDAR frontend on the same Keycloak realm,
    // so it opens in a new tab but the user stays signed in.
    service.getMonitoring = function () {
      return monitoringBase;
    };

    return service;
  }

});
