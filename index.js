/* eslint-env node */

'use strict';

const RSVP = require('rsvp');
const fs = require('fs');
const path = require('path');
const request = require('request-promise');
const zlib = require('zlib');

const BasePlugin = require('ember-cli-deploy-plugin');

module.exports = {
  name: 'ember-cli-deploy-bugsnag',

  createDeployPlugin: function(options) {
    const DeployPlugin = BasePlugin.extend({
      name: options.name,

      defaultConfig: {
        distDir: function(context) {
          return context.distDir;
        },
        distFiles: function(context) {
          return context.distFiles;
        },
        gzippedFiles: function(context) {
          return context.gzippedFiles || [];
        },
        revisionKey: function(context) {
          if (context.revisionData) {
            return context.revisionData.revisionKey;
          } else {
            return process.env.SOURCE_VERSION || '';
          }
        },
        includeAppVersion: true,
        deleteSourcemaps: true,
        overwrite: 'true',
      },

      requiredConfig: ['apiKey', 'publicUrl'],

      upload: function() {
        log('Uploading sourcemaps to bugsnag', { verbose: true });

        let log = this.log.bind(this);
        let apiKey = this.readConfig('apiKey');
        let revisionKey = this.readConfig('revisionKey');
        let distDir = this.readConfig('distDir');
        let distFiles = this.readConfig('distFiles');
        let publicUrl = this.readConfig('publicUrl');
        let overwrite = this.readConfig('overwrite');
        let includeAppVersion = this.readConfig('includeAppVersion');

        let jsMapPairs = this._fetchJSMapPairs(distFiles);

        let uploads = jsMapPairs.map(pair => {
          let mapFilePath = pair.mapFile;
          let jsFilePath = pair.jsFile;
          let formData = {
            apiKey: apiKey,
            overwrite: overwrite,
            minifiedUrl: publicUrl + jsFilePath,
            sourceMap: this._readSourceMap(path.join(distDir, mapFilePath))
          };
          if (revisionKey && includeAppVersion) {
            formData.appVersion = revisionKey;
          }

          log('formData', { verbose: true });
          log(JSON.stringify(formData, { verbose: true }));

          return request({
            uri: 'https://upload.bugsnag.com',
            method: 'POST',
            formData: formData
          });
        });

        return RSVP.all(uploads).then(function() {
          log('Finished uploading sourcemaps', { verbose: true });
        });
      },

      didUpload() {
        this.log('Deleting sourcemaps', { verbose: true });
        let deleteSourcemaps = this.readConfig('deleteSourcemaps');
        if (deleteSourcemaps) {
          let distDir = this.readConfig('distDir');
          let distFiles = this.readConfig('distFiles');
          let mapFilePaths = fetchFilePathsByType(distFiles, distDir, 'map');
          let promises = mapFilePaths.map(function(mapFilePath) {
            return new RSVP.Promise(function(resolve, reject) {
              fs.unlink(mapFilePath, function(err) {
                if (err) {
                  reject();
                } else {
                  resolve();
                }
              });
            });
          });

          return RSVP.all(promises);
        }
      },

      _readSourceMap(mapFilePath) {
        var relativeMapFilePath = mapFilePath.replace(this.readConfig('distDir') + '/', '');
        if (this.readConfig('gzippedFiles').indexOf(relativeMapFilePath) !== -1) {
          // When the source map is gzipped, we need to eagerly load it into a buffer
          // so that the actual content length is known.
          return {
            value: zlib.unzipSync(fs.readFileSync(mapFilePath)),
            options: {
              filename: path.basename(mapFilePath),
            }
          };
        } else {
          return fs.createReadStream(mapFilePath);
        }
      }
    });

    return new DeployPlugin();
  }
};

function fetchJSMapPairs(distFiles, publicUrl, distUrl) {
  var jsFiles = indexByBaseFilename(fetchFilePaths(distFiles, '', 'js'));
  return fetchFilePaths(distFiles, '', 'map').map(function(mapFile) {
    return {
      mapFile: distUrl + mapFile,
      jsFile: publicUrl + jsFiles[getBaseFilename(mapFile)]
    };
  });
}

function indexByBaseFilename(files) {
  return files.reduce(function(result, file) {
    result[getBaseFilename(file)] = file;
    return result;
  }, {});
}

function getBaseFilename(file) {
  return file.replace(/-[0-9a-f]+\.(js|map)$/, '');
}

function fetchFilePaths(distFiles, basePath, type) {
  return distFiles.filter(function(filePath) {
    return new RegExp('assets\/.*\\.' + type + '$').test(filePath);
  })
  .map(function(filePath) {
    return basePath + '/' + filePath;
  });
}
