import zapier, { defineApp } from 'zapier-platform-core';

import packageJson from '../package.json' with { type: 'json' };

import authentication from './authentication.js';
import { befores, afters } from './middleware.js';
import newLeadTrigger from './triggers/newLead.js';
import createLeadAction from './creates/createLead.js';

export default defineApp({
  version: packageJson.version,
  platformVersion: zapier.version,

  authentication,
  beforeRequest: [...befores],
  afterResponse: [...afters],

  triggers: {
    [newLeadTrigger.key]: newLeadTrigger,
  },

  creates: {
    [createLeadAction.key]: createLeadAction,
  },
});
