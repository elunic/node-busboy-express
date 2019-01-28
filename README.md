# busboy-express

[![Build Status](https://travis-ci.org/elunic/node-busboy-express.svg?branch=master)](https://travis-ci.org/elunic/node-busboy-express)

An express middleware for `busboy`, with TypeScript typings.

Works with ES5 if you include a global `Promise` library.

## Usage

**Note**: if you get errors about incompatible definitions of `Express.Request.files`, enable the `skipLibCheck` TypeScript compiler option.

* It is recommened to only include the middleware on routes that actually require it.
* On routes that have included the middleware, `req.fields` and `req.files` will be key-value objects, with the keys
  being the fieldnames and the values being arrays of values (for fields) or file descriptor objects (for files).

**Note**: Don't forget to **cleanup** by running `cleanup(req)`. Your route handler doesn't have to wait
  for its completion.

```javascript
const busboy = require('busboy-express');
const express = require('express');

const app = express();

app.post('/upload', busboy({fields: ['allowedfield'], files: ['allowedfile']}), (req, res, next) => {
  for (const fieldname in req.files) {
    for (const file of req.files[fieldname]) {
      moveUploadedFile(file.path, './uploads/' + file.originalFilename);
    }
  }
  
  for (const fieldname of req.fields) {
    // process field
  }
  
  busboy.cleanup(req);
});
```


### Middleware options

The `busboy` middleware takes an `Options` object. This object extends Busboy's own
`Config` object (the object passed to the `Busboy` constructor).

Documentation for the native `busboy` options object can be found at https://github.com/mscdex/busboy#busboy-methods.

It augments that object with a few options:

```
{
  "multipartOnly": true,
  "uploadPath": os.tmpdir(),
  "fields": true,
  "files": []
}
```


#### `multipartOnly` (boolean)

Handle `multipart/form-data` requests only. This enhances compatiblity if you are using another module
to handle `urlencoded` requests.

#### `uploadPath` (string)

The path to which files should be uploaded.

#### `fields` (boolean/string[])

An array of fieldnames that should be accepted as fields. No other fields will be processed when populating
`req.fields`.

Setting this to `true` allows all fields. Limits as defined through the native
`busboy` options still apply.

#### `files` (boolean/string[])

An array of fieldnames that should be accepted as files. No other files will be processed when populating
`req.files`.

Setting this to `true` allows all files. Limits as defined through the native
`busboy` options still apply. Use with caution and consider setting a file count/file size limit.


### Debug messages

This module uses `debug` with the `busboy-express` namespace.
