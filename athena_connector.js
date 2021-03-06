function isAdminUser(){
  return false;
}

function extractDataSchema(dataHeader){
  var schemaList = [];
  for(var i = 0; i < dataHeader.length; i++){
    var schema = {
      "name": dataHeader[i],
      "dataType": "STRING"
    };
    schemaList.push(schema);
  }
  
  return schemaList;
}

function transformDataStudioData(data, extractColumns){
  var fixedData = [];
  var targetColumn = [];
  Logger.log(extractColumns);
  var header = data[0];
  for(var i = 0; i < extractColumns.length; i++){
    if(header.indexOf(extractColumns[i]) >= 0){
      targetColumn.push(header.indexOf(extractColumns[i]));
    }
  }
  
  for(var i = 1; i < data.length; i++){
    var values = [];
    for(var j = 0; j < targetColumn.length; j++){
      values.push(data[i][targetColumn[j]]);
    }
    fixedData.push({
      "values": values
    });
  }
   
  return fixedData;
}

function setCredentials(request) {
  try {
    var key = request.key;
    var accessKey = key.split("_")[0];
    var secretKey = key.split("_")[1];
        
    var userProperties = PropertiesService.getUserProperties();
    userProperties.setProperty('aws_athena.access_key', accessKey);
    userProperties.setProperty('aws_athena.secret_id', secretKey);
    response = {
      "errorCode": "NONE"
    };
    console.log(response);
    return response;
  }catch(e){
    logConnectorError(e, "sample");
    throwConnectorError("setCredentialError, ");
  }
}

function getAuthType(){
  return {
    "type": "KEY"
  };
}

function resetAuth() {
  var userProperties = PropertiesService.getUserProperties();
  userProperties.deleteProperty('aws_athena.access_key');
  userProperties.deleteProperty('aws_athena.secret_id');
}

function isAuthValid(){
  var userProperties = PropertiesService.getUserProperties();
  var access_key = userProperties.getProperty('aws_athena.access_key');
  var secret_key = userProperties.getProperty('aws_athena.secret_id');
  console.log("auth validation.");
  if(access_key == null || secret_key == null){
    console.log("access_key or secret_key is not set.");
    return false;
  }
  
  return validateAuth(access_key, secret_key);
}

function validateAuth(access_key, secret_key){
  Athena.init(access_key, secret_key, "us-east-1");
  var response = Athena.listNamedQueries();
  console.log(response);
  if ("NamedQueryIds" in response){
    console.log("validation is succeeded.");
    return true;
  }
  console.log("validation is failed");
  return false;
}

function getConfig(){
  return config = {
    configParams: [
      {
        type: "TEXTAREA",
        name: "queryString",
        displayName: "querySQL",
        helpText:"Input Your SQL(クエリの結果はキャッシュされるので、させたくないならqueryの中身を少し変えてください)",
        placeholder: "select * from your_table",
        parameterControl: {
          allowOverride: true
        }
      },
      {
        type: "TEXTINPUT",
        name: "database",
        displayName: "database",
        helpText:"database",
        placeholder: "default",
        parameterControl: {
          allowOverride: true
        }
      },
      {
        type: "TEXTINPUT",
        name: "timeout",
        displayName: "timeout(msec)",
        helpText: "Query Timeout",
        placeholder: "30000",
        parameterControl: {
          allowOverride: true
        }
      },
      {
        type: "TEXTINPUT",
        name: "outputLocation",
        displayName: "outputLocation",
        helpText: "outputLocation(s3 bucket, like s3://aws-athena-query-results-huga",
        placeholder: "s3://aws-athena-query-result",
        parameterControl: {
          allowOverride: true
        }
      },
      {
        type: "TEXTINPUT",
        name: "region",
        displayName: "athena region",
        helpText: "region name",
        placeholder: "ap-northeast-1",
        parameterControl: {
          allowOverride: true
      }
      }
    ],
    
  };
}

function getSchema(request){
  console.log(request);
  var userProperties = PropertiesService.getUserProperties();
  var access_key = userProperties.getProperty('aws_athena.access_key');
  var secret_key = userProperties.getProperty('aws_athena.secret_id');
  var sql = request.configParams.queryString;
  var database = request.configParams.database;
  var outputLocation = request.configParams.outputLocation;
  var timeout = parseInt(request.configParams.timeout);
  var region = request.configParams.region;
  
  if(timeout == NaN){
    throw "Error: timeout is integer string";
  }
  Athena.init(access_key, secret_key, region);
  var queryId = Athena.query(sql, database, outputLocation);
  var state = Athena.waitQueryFinished(queryId, timeout);
  var csvData = Athena.fetchQueryResult(queryId);
  var dataSchema = extractDataSchema(csvData[0]);
  
  return {
    "schema": dataSchema
  };
}

function getData(request){
  console.log(request);
  //TODO: refactor
  var userProperties = PropertiesService.getUserProperties();
  var access_key = userProperties.getProperty('aws_athena.access_key');
  var secret_key = userProperties.getProperty('aws_athena.secret_id');
  var sql = request.configParams.queryString;
  var database = request.configParams.database;
  var outputLocation = request.configParams.outputLocation;
  var timeout = parseInt(request.configParams.timeout);
  var region = request.configParams.region;
  
  if(timeout == NaN){
    throw "Error: timeout is integer string";
  }
  Athena.init(access_key, secret_key, region);
  var queryId = Athena.query(sql, database, outputLocation);
  var state = Athena.waitQueryFinished(queryId, timeout);
  var csvData = Athena.fetchQueryResult(queryId);
  //var dataSchema = extractDataSchema(csvData[0]);
  var fields = request.fields
  var dataSchema = []
  var responseSchema = []
  for(var i = 0; i < fields.length; i++){
    dataSchema.push(fields[i].name);
    responseSchema.push({
      "name": fields[i].name,
      "dataType": "STRING"
    });
  }
  var responseData = transformDataStudioData(csvData, dataSchema);
  var dataResponse = {
    "schema": responseSchema,
    "rows": responseData,
    "cachedData": true
  };
  console.log(dataResponse);
  return dataResponse;
}

var Athena = (function(){
  var region;
  var s3;
  var serviceName = "athena";
  return {
    init: function Athena(access_key, secret_key, aws_region) {
      AWS.init(access_key, secret_key);
      region = aws_region;
      s3 = S3.getInstance(access_key, secret_key);
    },
    
    query: function(queryString, executionDatabase, outputLocation) {
      if(queryString == undefined) {
        throw "Error: Query undefined";
      }
      var d = new Date();
      var date = String(d.getUTCFullYear()) + addZero(d.getUTCMonth()+1) + addZero(d.getUTCDate());
      var token = Utilities.base64Encode(date + queryString + outputLocation);
      var fixedToken = token.substring(0, 128)
      requestParameter = {
        "ClientRequestToken": fixedToken,
        "QueryExecutionContext": {
          "Database": executionDatabase
        },
        "QueryString": queryString,
        "ResultConfiguration": {
          "OutputLocation": outputLocation
        }
      };
      var responseText = AWS.request(serviceName, region, "StartQueryExecution",{}, "POST", requestParameter);
      console.log(responseText);
      var response = JSON.parse(responseText);
      var executionId = response["QueryExecutionId"];
      
      return executionId;
    },
    fetchQueryStatus: function(queryId){
      if(queryId == undefined) {
        throw "Error: QueryId undefined";
      }
      var requestParameter = {
        "QueryExecutionId": queryId
      };
      var responseText = AWS.request(serviceName, region, "GetQueryExecution",{}, "POST", requestParameter);
      var response = JSON.parse(responseText);
      Logger.log(response);
      var state = response["QueryExecution"]["Status"]["State"];
      
      return state;
    },
    killQuery: function(queryId) {
      if(queryId == undefined) {
        throw "Error: QueryId undefined";
      }
      var requestParameter = {
        "QueryExecutionId": queryId
      };
      AWS.request(serviceName, region, "StopQueryExecution",{}, "POST", requestParameter);
    },
    waitQueryFinished: function(queryId, timeoutMillSec) {
      var waitTime = 0;
      var queryStatus = this.fetchQueryStatus(queryId);
      while(waitTime < timeoutMillSec && queryStatus != "SUCCEEDED"){
        console.log(queryStatus)
        queryStatus = this.fetchQueryStatus(queryId);
        waitTime += 1000;
        sleep(1000);
      }
      
      if (queryStatus != "SUCCEEDED") {
        this.killQuery(queryId);
        throw "Error: Query Timeout, killed query.";        
      }
      
      return "SUCCEEDED";
    },
    fetchQueryResult: function(queryId){
      if(queryId == undefined) {
        throw "Error: QueryId undefined";
      }
      var requestParameter = {
        "QueryExecutionId": queryId
      };
      var responseText = AWS.request(serviceName, region, "GetQueryExecution",{}, "POST", requestParameter);
      var response = JSON.parse(responseText);
      var outputLocation = response["QueryExecution"]["ResultConfiguration"]["OutputLocation"];
      var tmp = outputLocation.split("s3://")[1];
      var split = tmp.split("/");
      var s3Bucket = split[0];
      var objectPath = split.join("/").replace(s3Bucket + "/", "");
      console.log("s3Bucket: " + s3Bucket);
      console.log("objectPath: " + objectPath);
      
      var fromS3 = s3.getObject(s3Bucket, objectPath);
      var csv = Utilities.parseCsv(fromS3);
      
      return csv;
    },
    listNamedQueries: function(){
      var responseText = AWS.request(serviceName, region, "ListNamedQueries",{}, "POST", {});
      var response = JSON.parse(responseText);
      return response;
    }
  };
  function addZero(s) {
    if(Number(s) < 10) {
      return '0' + String(s);
    }
    return String(s);
  }
})();


var AWS = (function() {
  // Keys cannot be retrieved once initialized but can be changed
  var accessKey;
  var secretKey;
  
  return {
    /**
     * Sets up keys for authentication so you can make your requests. Keys are not gettable once added.
     * @param {string} access_key - your aws access key
     * @param {string} secret_key - your aws secret key
     */
     init: function AWS(access_key, secret_key) {
      if(access_key == undefined) {
        throw "Error: No access key provided";
      } else if(secret_key == undefined) {
        throw "Error: No secret key provided";
      }
      accessKey = access_key;
      secretKey = secret_key;
    },
    /**
     * Authenticates and sends the given parameters for an AWS api request.
     * @param {string} service - the aws service to connect to (e.g. 'ec2', 'iam', 'codecommit')
     * @param {string} region - the aws region your command will go to (e.g. 'us-east-1')
     * @param {string} action - the api action to call
     * @param {Object} [params] - the parameters to call on the action. Defaults to none.
     * @param {string} [method=GET] - the http method (e.g. 'GET', 'POST'). Defaults to GET.
     * @param {(string|object)} [payload={}] - the payload to send. Defults to ''.
     * @param {Object} [headers={Host:..., X-Amz-Date:...}] - the headers to attach to the request. Host and X-Amz-Date are premade for you.
     * @param {string} [uri='/'] - the path after the domain before the action. Defaults to '/'.
     * @return {string} the server response to the request
     */
     request: function(service, region, action, params, method, payload, headers, uri) {
      if(service == undefined) {
        throw "Error: Service undefined";
      } else if(region == undefined) {
        throw "Error: Region undefined";
      } else if(action == undefined) {
        throw "Error: Action undefined";
      }
      
      if(payload == undefined) {
        payload = "";
      } else if(typeof payload !== "string") {
        payload = JSON.stringify(payload);
      }
      Logger.log(payload)
      var Crypto = loadCrypto();
      
      var d = new Date();
      
      var dateStringFull =  String(d.getUTCFullYear()) + addZero(d.getUTCMonth()+1) + addZero(d.getUTCDate()) + "T" + addZero(d.getUTCHours()) + addZero(d.getUTCMinutes()) + addZero(d.getUTCSeconds()) + 'Z';
      var dateStringShort = String(d.getUTCFullYear()) + addZero(d.getUTCMonth()+1) + addZero(d.getUTCDate());
      var payload = payload || '';
      var method = method || "GET";
      var uri = uri || "/";
      var host = service+"."+region+".amazonaws.com";
      var headers = headers || {};
      var request;
      var query;
      
      if(method.toLowerCase() == "post") {
        request = "https://"+host+uri;
        query = '';
      } else {
        query = "Action="+action;
        if(params) {
          Object.keys(params).sort(function(a,b) { return a<b?-1:1; }).forEach(function(name) {
            query += "&"+name+"="+encodeURIComponent(params[name]);
          });
        }
        request = "https://"+host+uri+"?"+query;
      }
      
      var canonQuery = getCanonQuery(query);
      var canonHeaders = "";
      var signedHeaders = "";
      headers["Host"] = host;
      headers["X-Amz-Date"] = dateStringFull;
      if(service == "athena"){
        headers["X-Amz-Target"] = "AmazonAthena." + action;
      }else{
        headers["X-Amz-Target"] = action;
      }
      
      headers["Content-Type"] = "application/x-amz-json-1.1"
      Object.keys(headers).sort(function(a,b){return a<b?-1:1;}).forEach(function(h, index, ordered) {
        canonHeaders += h.toLowerCase() + ":" + headers[h] + "\n";
        signedHeaders += h.toLowerCase() + ";";
      });
      signedHeaders = signedHeaders.substring(0, signedHeaders.length-1);
      
      var CanonicalString = method+'\n'
      + uri+'\n'
      + query+'\n'
      + canonHeaders+'\n'
      + signedHeaders+'\n'
      + Crypto.SHA256(payload);
      var canonHash = Crypto.SHA256(CanonicalString);
      
      var algorithm = "AWS4-HMAC-SHA256";
      var scope = dateStringShort + "/"+region+"/"+service+"/aws4_request";
      
      var StringToSign = algorithm+'\n'
      + dateStringFull+'\n'
      + scope+'\n'
      + canonHash;
      
      var key = getSignatureKey(Crypto, secretKey, dateStringShort, region, service);
      var signature = Crypto.HMAC(Crypto.SHA256, StringToSign, key, { asBytes: false });
      
      var authHeader = algorithm +" Credential="+accessKey+"/"+scope+", SignedHeaders="+signedHeaders+", Signature="+signature;
      
      headers["Authorization"] = authHeader;
      
     
      delete headers["Host"];
      var options = {
        method: method,
        headers: headers,
        muteHttpExceptions: true,
        contentType:"application/x-amz-json-1.1",
        payload: payload,
      };
       Logger.log(request)
       Logger.log(options)
       Logger.log(headers)
      var response = UrlFetchApp.fetch(request, options);
      return response;
    },
    /**
     * Sets new authorization keys
     * @param {string} access_key - the new access_key
     * @param {string} secret_key - the new secret key
     */
     setNewKey: function(access_key, secret_key) {
      if(access_key == undefined) {
        throw "Error: No access key provided";
      } else if(secret_key == undefined) {
        throw "Error: No secret key provided";
      }
      accessKey = access_key;
      secretKey = secret_key;
    }
  };
  
  function getCanonQuery(r) {
    var query = r.split("&").sort().join("&");
    
    var canon = "";
    for(var i = 0; i < query.length; i++) {
      var element = query.charAt(i);
      if(isCanon(element)) {
        canon += element;
      } else {
        canon += "%"+element.charCodeAt(0).toString(16)
      }
    }

    return canon;
  }
  
  // For characters only
  function isCanon(c) {
    return /[a-z0-9-_.~=&]/i.test(c);
  }
  
  function addZero(s) {
    if(Number(s) < 10) {
      return '0' + String(s);
    }
    return String(s);
  }
  
  /**
   * Source: http://docs.aws.amazon.com/general/latest/gr/signature-v4-examples.html#signature-v4-examples-jscript
   */
  function getSignatureKey(Crypto, key, dateStamp, regionName, serviceName) {
    var kDate= Crypto.HMAC(Crypto.SHA256, dateStamp, "AWS4" + key, { asBytes: true});
    var kRegion= Crypto.HMAC(Crypto.SHA256, regionName, kDate, { asBytes: true });
    var kService=Crypto.HMAC(Crypto.SHA256, serviceName, kRegion, { asBytes: true });
    var kSigning= Crypto.HMAC(Crypto.SHA256, "aws4_request", kService, { asBytes: true });
    
    return kSigning;
  }
  
  function loadCrypto() {
      var window = {};
      var Crypto = undefined;
      /*
       * Crypto-JS v2.5.3
       * http://code.google.com/p/crypto-js/
       * (c) 2009-2012 by Jeff Mott. All rights reserved.
       * http://code.google.com/p/crypto-js/wiki/License
       */
      // start sha256/CryptoJS
      (typeof Crypto=="undefined"||!Crypto.util)&&function(){var d=window.Crypto={},k=d.util={rotl:function(b,a){return b<<a|b>>>32-a},rotr:function(b,a){return b<<32-a|b>>>a},endian:function(b){if(b.constructor==Number)return k.rotl(b,8)&16711935|k.rotl(b,24)&4278255360;for(var a=0;a<b.length;a++)b[a]=k.endian(b[a]);return b},randomBytes:function(b){for(var a=[];b>0;b--)a.push(Math.floor(Math.random()*256));return a},bytesToWords:function(b){for(var a=[],c=0,e=0;c<b.length;c++,e+=8)a[e>>>5]|=(b[c]&255)<<
        24-e%32;return a},wordsToBytes:function(b){for(var a=[],c=0;c<b.length*32;c+=8)a.push(b[c>>>5]>>>24-c%32&255);return a},bytesToHex:function(b){for(var a=[],c=0;c<b.length;c++)a.push((b[c]>>>4).toString(16)),a.push((b[c]&15).toString(16));return a.join("")},hexToBytes:function(b){for(var a=[],c=0;c<b.length;c+=2)a.push(parseInt(b.substr(c,2),16));return a},bytesToBase64:function(b){if(typeof btoa=="function")return btoa(g.bytesToString(b));for(var a=[],c=0;c<b.length;c+=3)for(var e=b[c]<<16|b[c+1]<<
          8|b[c+2],p=0;p<4;p++)c*8+p*6<=b.length*8?a.push("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/".charAt(e>>>6*(3-p)&63)):a.push("=");return a.join("")},base64ToBytes:function(b){if(typeof atob=="function")return g.stringToBytes(atob(b));for(var b=b.replace(/[^A-Z0-9+\/]/ig,""),a=[],c=0,e=0;c<b.length;e=++c%4)e!=0&&a.push(("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/".indexOf(b.charAt(c-1))&Math.pow(2,-2*e+8)-1)<<e*2|"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/".indexOf(b.charAt(c))>>>
          6-e*2);return a}},d=d.charenc={};d.UTF8={stringToBytes:function(b){return g.stringToBytes(unescape(encodeURIComponent(b)))},bytesToString:function(b){return decodeURIComponent(escape(g.bytesToString(b)))}};var g=d.Binary={stringToBytes:function(b){for(var a=[],c=0;c<b.length;c++)a.push(b.charCodeAt(c)&255);return a},bytesToString:function(b){for(var a=[],c=0;c<b.length;c++)a.push(String.fromCharCode(b[c]));return a.join("")}}}();
          Crypto = window.Crypto;
          (function(){var d=Crypto,k=d.util,g=d.charenc,b=g.UTF8,a=g.Binary,c=[1116352408,1899447441,3049323471,3921009573,961987163,1508970993,2453635748,2870763221,3624381080,310598401,607225278,1426881987,1925078388,2162078206,2614888103,3248222580,3835390401,4022224774,264347078,604807628,770255983,1249150122,1555081692,1996064986,2554220882,2821834349,2952996808,3210313671,3336571891,3584528711,113926993,338241895,666307205,773529912,1294757372,1396182291,1695183700,1986661051,2177026350,2456956037,2730485921,
            2820302411,3259730800,3345764771,3516065817,3600352804,4094571909,275423344,430227734,506948616,659060556,883997877,958139571,1322822218,1537002063,1747873779,1955562222,2024104815,2227730452,2361852424,2428436474,2756734187,3204031479,3329325298],e=d.SHA256=function(b,c){var f=k.wordsToBytes(e._sha256(b));return c&&c.asBytes?f:c&&c.asString?a.bytesToString(f):k.bytesToHex(f)};e._sha256=function(a){a.constructor==String&&(a=b.stringToBytes(a));var e=k.bytesToWords(a),f=a.length*8,a=[1779033703,3144134277,
              1013904242,2773480762,1359893119,2600822924,528734635,1541459225],d=[],g,m,r,i,n,o,s,t,h,l,j;e[f>>5]|=128<<24-f%32;e[(f+64>>9<<4)+15]=f;for(t=0;t<e.length;t+=16){f=a[0];g=a[1];m=a[2];r=a[3];i=a[4];n=a[5];o=a[6];s=a[7];for(h=0;h<64;h++){h<16?d[h]=e[h+t]:(l=d[h-15],j=d[h-2],d[h]=((l<<25|l>>>7)^(l<<14|l>>>18)^l>>>3)+(d[h-7]>>>0)+((j<<15|j>>>17)^(j<<13|j>>>19)^j>>>10)+(d[h-16]>>>0));j=f&g^f&m^g&m;var u=(f<<30|f>>>2)^(f<<19|f>>>13)^(f<<10|f>>>22);l=(s>>>0)+((i<<26|i>>>6)^(i<<21|i>>>11)^(i<<7|i>>>25))+
                (i&n^~i&o)+c[h]+(d[h]>>>0);j=u+j;s=o;o=n;n=i;i=r+l>>>0;r=m;m=g;g=f;f=l+j>>>0}a[0]+=f;a[1]+=g;a[2]+=m;a[3]+=r;a[4]+=i;a[5]+=n;a[6]+=o;a[7]+=s}return a};e._blocksize=16;e._digestsize=32})();
                (function(){var d=Crypto,k=d.util,g=d.charenc,b=g.UTF8,a=g.Binary;d.HMAC=function(c,e,d,g){e.constructor==String&&(e=b.stringToBytes(e));d.constructor==String&&(d=b.stringToBytes(d));d.length>c._blocksize*4&&(d=c(d,{asBytes:!0}));for(var f=d.slice(0),d=d.slice(0),q=0;q<c._blocksize*4;q++)f[q]^=92,d[q]^=54;c=c(f.concat(c(d.concat(e),{asBytes:!0})),{asBytes:!0});return g&&g.asBytes?c:g&&g.asString?a.bytesToString(c):k.bytesToHex(c)}})();
      // end sha256/CryptoJS

      return window.Crypto;
  }
})();

function logConnectorError(originalError, message) {
    var logEntry = [
      'Original error (Message): ',
      originalError,
      '(', message, ')'
    ];
    console.error(logEntry.join('')); // Log to Stackdriver.
}

function throwConnectorError(message, userSafe) {
  userSafe = (typeof userSafe !== 'undefined' &&
              typeof userSafe === 'boolean') ?  userSafe : false;
  if (userSafe) {
    message = 'DS_USER:' + message;
  }
   throw new Error(message);
}
