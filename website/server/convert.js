/* eslint-disable no-console */
const fs = require('fs');
const glob = require('glob');
const mkdirp = require('mkdirp');
const optimist = require('optimist');
const path = require('path');
const toSlug = require('../components/toSlug');

const argv = optimist.argv;

function splitHeader(content) {
  const lines = content.split('\n');
  let i = 1;
  for (; i < lines.length - 1; i += 1) {
    if (lines[i] === '---') {
      break;
    }
  }
  return {
    header: lines.slice(1, i + 1).join('\n'),
    content: lines.slice(i + 1).join('\n'),
  };
}

function globEach(pattern, cb) {
  glob(pattern, (err, files) => {
    if (err) {
      console.error(err);
      return;
    }
    files.forEach(cb);
  });
}

function rmFile(file) {
  try {
    fs.unlinkSync(file);
  } catch (e) {
    /* seriously, unlink throws when the file doesn't exist :( */
  }
}

function backtickify(str) {
  // eslint-disable-next-line prefer-template
  let escaped = '`' + str.replace(/\\/g, '\\\\').replace(/`/g, '\\`') + '`';
  // Replace require( with require\( so node-haste doesn't replace example
  // require calls in the docs
  escaped = escaped.replace(/require\(/g, 'require\\(');

  // Replace ${var} with \${var} so we can use place holders
  // eslint-disable-next-line no-template-curly-in-string
  return escaped.replace(/\$\{([\w\s\d':.()?]*)\}/g, '\\${$1}');
}

// Extract markdown metadata header
function extractMetadata(content) {
  const metadata = {};
  const both = splitHeader(content);
  const lines = both.header.split('\n');
  for (let i = 0; i < lines.length - 1; i += 1) {
    const keyvalue = lines[i].split(':');
    const key = keyvalue[0].trim();
    let value = keyvalue
      .slice(1)
      .join(':')
      .trim();
    // Handle the case where you have "Community #10"
    try {
      value = JSON.parse(value);
    } catch (e) {} // eslint-disable-line no-empty
    metadata[key] = value;
  }
  return { metadata, rawContent: both.content };
}

const TABLE_OF_CONTENTS_TOKEN = '<AUTOGENERATED_TABLE_OF_CONTENTS>';

const insertTableOfContents = rawContent => {
  const regexp = /\n###\s+(`.*`.*)\n/g;
  let match;
  const headers = [];
  while ((match = regexp.exec(rawContent))) {
    headers.push(match[1]);
  }

  const tableOfContents = headers
    .map(header => `  - [${header}](#${toSlug(header)})`)
    .join('\n');

  return rawContent.replace(TABLE_OF_CONTENTS_TOKEN, tableOfContents);
};

function buildFile(layout, metadata, rawContent) {
  let formattedContent = rawContent;
  if (rawContent && rawContent.indexOf(TABLE_OF_CONTENTS_TOKEN) !== -1) {
    formattedContent = insertTableOfContents(rawContent);
  }

  return `/**
 * @generated
 */
import React, { Component } from 'react';
import Layout from '../../layout/${layout}';

${formattedContent ? `const content = ${backtickify(formattedContent)};` : ''}

export default class Post extends Component {
${formattedContent ? 'static content = content;' : ''}
  render() {
    return (
      <Layout metadata={${JSON.stringify(metadata)}}>
        ${formattedContent ? '{content}' : ''}
      </Layout>
    );
  }
};
`;
}

function writeFileAndCreateFolder(file, content) {
  mkdirp.sync(file.replace(new RegExp('/[^/]*$'), ''));
  fs.writeFileSync(file, content);
}

function execute(cb = null) {
  const DOCS_MD_DIR = '../docs/';

  globEach('src/docs/*.*', rmFile);

  glob(`${DOCS_MD_DIR}**/*.*`, (er, files) => {
    const metadatas = {
      files: [],
    };

    files.forEach(file => {
      const extension = path.extname(file);
      if (extension === '.md' || extension === '.markdown') {
        const res = extractMetadata(fs.readFileSync(file, 'utf8'));
        const metadata = res.metadata;
        const rawContent = res.rawContent;
        metadata.source = path.basename(file);
        metadatas.files.push(metadata);

        if (metadata.permalink.match(/^https?:/)) {
          return;
        }

        // Create a dummy .js version that just calls the associated layout
        const layout = `${metadata.layout[0].toUpperCase()}${metadata.layout.substr(
          1,
        )}Layout`;

        writeFileAndCreateFolder(
          `src/${metadata.permalink.replace(/\.html$/, '.js')}`,
          buildFile(layout, metadata, rawContent),
        );
      }

      if (extension === '.json') {
        const content = fs.readFileSync(file, 'utf8');
        metadatas[path.basename(file, '.json')] = JSON.parse(content);
      }
    });

    fs.writeFile(
      'components/metadata.js',
      `/* eslint-disable */
export default ${JSON.stringify(metadatas, null, 2)};`,
      () => {
        if (cb != null) {
          cb();
        }
      },
    );
  });
}

if (argv.convert) {
  console.log('convert!');
  execute();
}

module.exports = execute;
