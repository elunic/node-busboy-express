import * as Busboy from 'busboy';
import * as Debug from 'debug';
import { NextFunction, Request, Response } from 'express';
import * as fs from 'fs-extra';
import * as os from 'os';
import * as path from 'path';
import * as uniqid from 'uniqid';
import * as util from 'util';

const debug = Debug('busboy-express');

const defaultOptions: Options = {
  multipartOnly: true,
  uploadPath: os.tmpdir(),
  fields: true,
  files: [],
};

export interface File {
  fieldname: string;
  filename: string;
  path: string;
  encoding: string;
  mimetype: string;
  size: number;
}
export interface Files {
  [key: string]: File[];
}

export type Field = unknown;
export interface Fields {
  [key: string]: Field[];
}

export interface Options extends busboy.BusboyConfig {
  multipartOnly?: boolean;
  uploadPath?: string;
  fields?: string[] | boolean;
  files?: string[] | boolean;
}

declare global {
  namespace Express {
    interface Request {
      fields: Fields;
      files: Files;
    }
  }
}

function busboyExpress(mwOptions?: Options) {
  const options: Options = Object.assign({}, defaultOptions, mwOptions || {});

  return function busboyMiddleware(req: Request, res: Response, next: NextFunction) {
    try {
      if (req.method !== 'POST') {
        next();
      }

      if (
        options.multipartOnly &&
        (!req.headers['content-type'] ||
          !req.headers['content-type'].includes('multipart/form-data'))
      ) {
        next();
      }

      if (
        (!options.fields || (options.fields instanceof Array && !options.fields.length)) &&
        (!options.files || (options.files instanceof Array && !options.files.length))
      ) {
        // Nothing to do.
        next();
      }

      debug(`${req.method} ${req.url}`);

      req.files = {};
      req.fields = {};

      const fileWritePromises: Array<Promise<void>> = [];

      const busboy = new Busboy({ headers: req.headers });
      busboy.on('file', (fieldname, stream, filename, encoding, mimetype) => {
        if (
          !options.files ||
          (options.files instanceof Array && !options.files.includes(fieldname))
        ) {
          stream.resume();
          return;
        }

        const targetPath = path.join(options.uploadPath || defaultOptions.uploadPath!, uniqid());
        debug(
          `${req.method} ${req.url}` +
            ` FILE [${fieldname}]:` +
            ` filename: ${filename}, ` +
            ` encoding: ${encoding}, ` +
            ` mimetype: ${mimetype}, ` +
            ` targetPath: ${targetPath}` +
            ``,
        );

        fileWritePromises.push(
          new Promise((resolve, reject) => {
            try {
              stream.on('error', err => {
                debug(
                  `${req.method} ${req.url}` +
                    ` READ ERROR: ` +
                    ` FILE [${fieldname}]:` +
                    ` filename: ${filename} ` +
                    ``,
                  err,
                );

                resolve();
              });

              const wStream = fs.createWriteStream(targetPath);
              wStream.on('error', err => {
                debug(
                  `${req.method} ${req.url}` +
                    ` WRITE ERROR: ` +
                    ` FILE [${fieldname}]:` +
                    ` filename: ${filename} ` +
                    ``,
                  err,
                );
              });

              stream.pipe(
                wStream,
                { end: false },
              );
              stream.on('end', () => {
                wStream.end(async () => {
                  try {
                    const stats = await fs.stat(targetPath);

                    if (!req.files.hasOwnProperty(fieldname)) {
                      req.files[fieldname] = [];
                    }

                    req.files[fieldname].push({
                      fieldname,
                      path: targetPath,
                      size: stats.size,
                      filename,
                      encoding,
                      mimetype,
                    });
                    resolve();
                  } catch (err) {
                    debug(
                      `${req.method} ${req.url}` +
                        ` STAT ERROR: ` +
                        ` FILE [${fieldname}]:` +
                        ` filename: ${filename} ` +
                        ``,
                      err,
                    );
                    resolve();
                  }
                });
              });
            } catch (err) {
              debug(
                `${req.method} ${req.url}` +
                  ` FILE ERROR: ` +
                  ` FILE [${fieldname}]:` +
                  ` filename: ${filename} ` +
                  ``,
                err,
              );
            }
          }),
        );
      });

      busboy.on('field', (fieldname, val, fieldnameTruncated, valTruncated, encoding, mimetype) => {
        if (
          !options.fields ||
          (options.fields instanceof Array && !options.fields.includes(fieldname))
        ) {
          return;
        }

        debug(
          `${req.method} ${req.url}` +
            ` FIELD [${fieldname}]:` +
            ` value: ${util.inspect(val)}, ` +
            ` encoding: ${encoding}, ` +
            ` mimetype: ${mimetype}, ` +
            ``,
        );

        if (!req.fields.hasOwnProperty(fieldname)) {
          req.fields[fieldname] = [];
        }

        req.fields[fieldname].push(val);
      });

      busboy.on('finish', async () => {
        debug(`${req.method} ${req.url} FINISH, awaiting file writes`);
        await Promise.all(fileWritePromises);
        debug(`${req.method} ${req.url} DONE`);

        next();
      });

      busboy.on('error', (err: Error) => {
        debug(`${req.method} ${req.url} ERROR`, err);

        next(err);
      });

      req.pipe(busboy);
    } catch (err) {
      next(err);
    }
  };
}

async function cleanup(req: Request) {
  if (req.files) {
    try {
      await Promise.all(
        Object.keys(req.files).map(async fieldname => {
          await Promise.all(
            req.files[fieldname].map(async file => {
              try {
                if (await fs.pathExists(file.path)) {
                  await fs.remove(file.path);
                }
              } catch (err) {
                debug(`Failed to cleanup file: ${file.path} (${file.filename}`, err);
              }
            }),
          );
        }),
      );
    } catch (err) {
      debug(`Error cleaning up uploaded files`, err);
    }
  }
}

busboyExpress.cleanup = cleanup;

export default busboyExpress;
export { cleanup, busboyExpress, busboyExpress as busboy };
