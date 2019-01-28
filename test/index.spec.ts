import { asyncErrorWrapper } from '@elunic/express-async-error-wrapper';
import * as express from 'express';
import { Express, NextFunction, Request, Response } from 'express';
import * as fs from 'fs-extra';
import getPort = require('get-port');
import { Server } from 'http';
import * as os from 'os';
import ow from 'ow';
import * as path from 'path';
import * as request from 'supertest';
import * as uniqid from 'uniqid';
const errorHandler = require('@elunic/express-error-handler');

import { busboyExpress, cleanup } from '../src/index';

describe('multiparser', () => {
  let app: Express;
  let server: Server;
  let errorMw;

  beforeEach(async () => {
    // Setup express
    app = express();

    app.post(
      '/test',
      busboyExpress({
        fields: ['data'],
        files: ['attachments'],
      }),
      asyncErrorWrapper(async (req: Request, res: Response, next: NextFunction) => {
        ow(req.files, 'files', ow.object.nonEmpty.hasKeys('attachments'));
        ow(req.fields, 'fields', ow.object.nonEmpty.hasKeys('data'));

        try {
          const uploadedFiles = await Promise.all(
            req.files.attachments.map(async file => {
              const finalPath = path.join(os.tmpdir(), file.filename);
              await fs.move(file.path, finalPath);

              return {
                ...file,
                uploadedFilePath: finalPath,
              };
            }),
          );

          res.status(200).json({
            data: {
              fields: req.fields,
              files: {
                attachments: uploadedFiles,
              },
            },
            meta: {},
          });
        } catch (err) {
          err.message = `multiparser failed to upload files: ${err.message}`;
          throw err;
        } finally {
          cleanup(req);
        }
      }),
    );

    // Error handler
    // Setup error handler after all other middlewares/routes
    errorMw = errorHandler({
      full: true,
    });
    app.use(errorMw);

    // Start express
    return new Promise(async (resolve, reject) => {
      try {
        server = app.listen(await getPort(), (err: Error) => {
          if (err) {
            return reject(err);
          }

          resolve();
        });
      } catch (ex) {
        reject(ex);
      }
    });
  });

  afterEach(async () => {
    // Stop server
    return new Promise((resolve, reject) => {
      server.close((err: Error) => {
        if (err) {
          return reject(err);
        }

        resolve();
      });
    });
  });

  let _request: request.Test;

  describe('valid calls', () => {
    let _filename: string;
    const _filecontent = 'attachment1';

    beforeEach(async () => {
      _filename = uniqid();

      _request = request(app)
        .post('/test')
        .attach('attachments', Buffer.from(_filecontent), {
          filename: _filename,
          contentType: 'text/plain',
        })
        .attach('ignoredattachments', Buffer.from('ignoredfilecontent'), {
          filename: 'ignoredfilename',
          contentType: 'text/plain',
        })
        .field('data', 'fieldvalue')
        .field('data', 'fieldvalue2')
        .field('ignoredfield', 'ignoredvalue')
        .set('Accept', 'application/json');
    });

    it('should return HTTP status 200', async () => {
      await _request.expect(200).then();
    });

    it('should return Content-Type application/json', async () => {
      await _request.expect('Content-Type', 'application/json; charset=utf-8').then();
    });

    it('should return JSON indicating the received fields and files', async () => {
      await _request
        .expect(res => {
          expect(res.body).toEqual({
            data: {
              fields: {
                data: ['fieldvalue', 'fieldvalue2'],
              },
              files: {
                attachments: [
                  jasmine.objectContaining({
                    fieldname: 'attachments',
                    filename: _filename,
                    size: _filecontent.length,
                    uploadedFilePath: jasmine.any(String),
                  }),
                ],
              },
            },
            meta: {},
          });
        })
        .then();
    });
  });

  describe('INvalid calls', () => {
    let _filename: string;
    const _filecontent = 'attachment1';

    beforeEach(async () => {
      _filename = uniqid();

      _request = request(app)
        .post('/test')
        .field('foo', 'bar')
        .set('Accept', 'application/json');
    });

    it('should return HTTP status 400', async () => {
      await _request.expect(400).then();
    });

    it('should return Content-Type application/json', async () => {
      await _request.expect('Content-Type', 'application/json; charset=utf-8').then();
    });

    it('should return JSON indicating the error', async () => {
      await _request
        .expect(res => {
          expect(res.body).toEqual({
            error: jasmine.objectContaining({
              type: 'ArgumentError',
            }),
          });
        })
        .then();
    });
  });
});
