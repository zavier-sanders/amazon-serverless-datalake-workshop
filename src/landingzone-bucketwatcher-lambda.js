const AWS = require('aws-sdk');
AWS.config.update({
    region: 'us-east-1'
});
const dynamoDB = new AWS.DynamoDB();
const s3 = new AWS.S3();

const DL_CATALOG_DB_NAME = process.env.DL_CATALOG_DB_NAME;
const LZ_LOGENTRY_DB_NAME = process.env.LZ_LOGENTRY_DB_NAME;
const DL_S3_BUCKET_NAME = process.env.DL_S3_BUCKET_NAME;
const LZ_S3_BUCKET_NAME = process.env.LZ_S3_BUCKET_NAME;
const DL_EXCEPTION_S3_BUCKET_NAME = process.env.DL_EXCEPTION_S3_BUCKET_NAME;

exports.handler = async (event, context, callback) => {
    console.log('Processing event:', JSON.stringify(event, null, 3));

    if (event.Records.length > 0 && event.Records[0].eventSource == 'aws:s3') {
        // get s3 object name
        let s3ObjectName = event.Records[0].s3.object.key;
        let s3ObjectSize = event.Records[0].s3.object.size.toString();
        let eventTime = event.Records[0].eventTime;

        // parse s3 Object
        let parts = s3ObjectName.split('_');
        let token = parts[1];
        let date = parts[2].split('.')[0];
        let formattedDate = parseDate(date);

        // check if db has token
        let dataset = await dataSetLookup(token);

        if (dataset) {
            // get landing zone file data
            let landingZoneFileData = await getFileFromLandingZone(s3ObjectName);

            // upload to data lake
            let key = formatFilePath(dataset, formattedDate) + s3ObjectName;
            await uploadFileToDataLake(key, landingZoneFileData);

            // add log entry
            let logEntry = {
                Timestamp: eventTime,
                LZ_S3_Object_Name: s3ObjectName,
                LZ_S3_Object_Size: s3ObjectSize,
                DL_S3_Object_Path: key
            };
            addLogEntryToDB(logEntry);

            callback();
        } else {
            // not valid dataset. move to exceptions bucket
            let landingZoneFileData = await getFileFromLandingZone(s3ObjectName);

            // upload to exception bucket
            let key = s3ObjectName;
            await uploadFileToExceptionBucket(key, landingZoneFileData);

            // add log entry
            let logEntry = {
                Timestamp: eventTime,
                LZ_S3_Object_Name: s3ObjectName,
                LZ_S3_Object_Size: s3ObjectSize,
                DL_S3_Object_Path: 'N/A'
            };
            addLogEntryToDB(logEntry);

            callback();
        }
    }

    callback();
};

// get file data from landingzone
const getFileFromLandingZone = (key) => {
    return new Promise((resolve, reject) => {
        var params = {
            Bucket: LZ_S3_BUCKET_NAME,
            Key: key,
        }

        // Retrieve the object
        s3.getObject(params, function (err, data) {
            if (err) {
                console.log(err, err.stack);
                reject(err);
            } else {
                console.log("Raw text:\n" + data.Body.toString('ascii'));
                resolve(data.Body);
            }
        });
    })
}

// check catalog db for dataset token
const dataSetLookup = (token) => {
    return new Promise((resolve, reject) => {
        let params = {
            TableName: DL_CATALOG_DB_NAME,
            Key: {
                "DS_Token": {
                    S: token
                }
            }
        }

        dynamoDB.getItem(params, function (err, data) {
            if (err) {
                console.log(err); // an error occurred
                reject(err)
            } else {
                console.log(data); // successful response
                resolve(data.Item);
            }
        });
    })

}

// upload to datalake
const uploadFileToDataLake = (key, data) => {
    return new Promise((resolve, reject) => {
        var params = {
            Bucket: DL_S3_BUCKET_NAME,
            Key: key,
            Body: data
        }

        s3.putObject(params, function (err, data) {
            if (err) {
                console.log(err, err.stack); // an error occurred
                reject(err);
            } else {
                console.log(data); // successful response
                resolve(data);
            }
        });
    })
}

// upload to exception bucket
const uploadFileToExceptionBucket = (key, data) => {
    return new Promise((resolve, reject) => {
        var params = {
            Bucket: DL_EXCEPTION_S3_BUCKET_NAME,
            Key: key,
            Body: data
        }

        s3.putObject(params, function (err, data) {
            if (err) {
                console.log(err, err.stack); // an error occurred
                reject(err);
            } else {
                console.log(data); // successful response
                resolve(data);
            }
        });
    })
}

// format file path
const formatFilePath = (dataset, date) => {
    let partitioningScheme = dataset.Partitioning_Scheme;
    let filePath = 'default/';

    if (partitioningScheme.S == 'YMD') {
        filePath = `${dataset.DL_Location.S}Year=${date.year}/Month=${date.month}/Day=${date.day}/`
    }

    return filePath;
}

// format the date string
const parseDate = (date) => {
    return {
        month: date.substring(0, 2),
        day: date.substring(2, 4),
        year: date.substring(4)
    }
}

const addLogEntryToDB = (data) => {
    return new Promise((resolve, reject) => {
        let params = {
            TableName: LZ_LOGENTRY_DB_NAME,
            Item: {
                Timestamp: {
                    "S": data.Timestamp
                },
                LZ_S3_Object_Name: {
                    "S": data.LZ_S3_Object_Name
                },
                LZ_S3_Object_Size: {
                    "S": data.LZ_S3_Object_Size
                },
                DL_S3_Object_Path: {
                    "S": data.DL_S3_Object_Path
                },
            }
        }

        dynamoDB.putItem(params, function (err, data) {
            if (err) {
                console.log(err); // an error occurred
                reject(err)
            } else {
                console.log(data); // successful response
                resolve(data.Item);
            }
        });
    })
}