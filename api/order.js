const https = require('https');
const http = require('http');
const crypto = require('crypto');
const querystring = require('querystring');

const CONFIG = {
  api_key: 'c66289394c2a6e8515c8e8b382fba719',
  offer_id: '7594',
  user_id: '75329',
  api_domain: 'https://t-api.org',
};

function checkSum(jsonData) {
  return crypto.createHash('sha1').update(jsonData + CONFIG.api_key).digest('hex');
}

function makeRequest(data, model, method) {
  return new Promise((resolve, reject) => {
    const payload = {
      user_id: CONFIG.user_id,
      data: data,
    };

    const jsonData = JSON.stringify(payload);
    const checkSumValue = checkSum(jsonData);

    const url = new URL(
      `${CONFIG.api_domain}/api/${model}/${method}?check_sum=${encodeURIComponent(checkSumValue)}`
    );

    const options = {
      hostname: url.hostname,
      port: url.port || 443,
      path: url.pathname + url.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(jsonData),
      },
    };

    const protocol = url.protocol === 'https:' ? https : http;

    const req = protocol.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => (body += chunk));
      res.on('end', () => {
        resolve({
          http_code: res.statusCode,
          result: body,
          error: '',
          errno: 0,
        });
      });
    });

    req.on('error', (err) => {
      resolve({
        http_code: 0,
        result: '',
        error: err.message,
        errno: 1,
      });
    });

    req.setTimeout(30000, () => {
      req.destroy();
      resolve({
        http_code: 0,
        result: '',
        error: 'Request timeout',
        errno: 1,
      });
    });

    req.write(jsonData);
    req.end();
  });
}

function parseFormBody(body) {
  const params = {};
  const pairs = body.split('&');
  for (const pair of pairs) {
    const [key, ...rest] = pair.split('=');
    if (key) {
      params[decodeURIComponent(key)] = decodeURIComponent(rest.join('=').replace(/\+/g, ' '));
    }
  }
  return params;
}

module.exports = async (req, res) => {
  // Only allow POST
  if (req.method !== 'POST') {
    res.writeHead(302, { Location: '/' });
    res.end();
    return;
  }

  // Parse the body
  let body = '';
  await new Promise((resolve) => {
    req.on('data', (chunk) => (body += chunk));
    req.on('end', resolve);
  });

  let params;
  const contentType = req.headers['content-type'] || '';

  if (contentType.includes('application/json')) {
    try {
      params = JSON.parse(body);
    } catch (e) {
      params = {};
    }
  } else {
    params = parseFormBody(body);
  }

  // Validate required fields
  if (!params.name || !params.phone) {
    const referer = req.headers.referer || '/';
    res.writeHead(302, { Location: referer });
    res.end();
    return;
  }

  // Build lead data
  const query = req.query || {};
  const data = {
    name: (params.name || '').trim(),
    phone: (params.phone || '').trim(),
    offer_id: CONFIG.offer_id,
    country: (params.country || 'BA').trim(),
  };

  const optionalParams = [
    'tz', 'address', 'region', 'city', 'zip', 'stream_id', 'count',
    'email', 'user_comment',
    'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content',
    'sub_id', 'sub_id_1', 'sub_id_2', 'sub_id_3', 'sub_id_4',
    'referer', 'user_agent', 'ip',
  ];

  // Merge form params and query params for optional fields
  for (const key of optionalParams) {
    const value = params[key] || query[key];
    if (value) {
      data[key] = value;
    }
  }

  // Set referer from query or header
  if (!data.referer) {
    data.referer = query.referer || req.headers.referer || '';
  }

  try {
    const response = await makeRequest(data, 'lead', 'create');

    if (response.http_code === 200 && response.errno === 0) {
      let responseBody;
      try {
        responseBody = JSON.parse(response.result);
      } catch (e) {
        res.status(500).send('JSON response error');
        return;
      }

      if (responseBody.status === 'ok') {
        const leadId = responseBody.data ? responseBody.data.id : '';
        res.writeHead(302, { Location: `/success.html?id=${leadId}` });
        res.end();
        return;
      } else if (responseBody.status === 'error') {
        res.status(400).send(responseBody.error || 'API error');
        return;
      } else {
        res.status(500).send('Unknown response status');
        return;
      }
    } else {
      if (response.result) {
        let responseBody;
        try {
          responseBody = JSON.parse(response.result);
        } catch (e) {
          res.status(500).send('JSON response error');
          return;
        }

        if (responseBody.status === 'error') {
          res.status(400).send(responseBody.error || 'API error');
          return;
        } else {
          res.status(500).send('Unknown response status');
          return;
        }
      } else {
        res.status(500).send('HTTP request error. ' + response.error);
        return;
      }
    }
  } catch (e) {
    res.status(500).send(e.message || 'Internal server error');
  }
};
