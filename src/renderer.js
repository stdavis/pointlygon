import './index.css';
import { remote } from 'electron';
import parse from 'csv-parse/lib/sync';
import fs from 'fs';
import stringify from 'csv-stringify/lib/sync';
import path from 'path';

const getParameters = () => {
  const inputNodes = document.getElementsByTagName('input');
  const parameters = {};

  for (let node of inputNodes) {
    parameters[node.id] = node.value;
  };
  console.log('parameters', parameters);

  return parameters;
};

const { apiKey, tableName, fieldName, inputId, inputStreet, inputZone } = getParameters();

window.openFile = async () => {
  console.log('openFile');
  const filePaths = remote.dialog.showOpenDialogSync();
  console.log('filePaths', filePaths);

  const csvPath = filePaths[0];
  const outputFilePath = `${path.dirname(csvPath)}/${path.basename(csvPath, '.csv')}_Attributed.csv`;
  console.log('outputFilePath', outputFilePath);

  // read records
  const fileContents = fs.readFileSync(csvPath, 'utf8');
  const records = parse(fileContents, {
    columns: true,
    skip_empty_lines: true
  });
  console.log(records);

  const recordsForGeocoding = etlRecordsForGeocoding(records, inputId, inputStreet, inputZone);
  const response = await fetch(`https://api.mapserv.utah.gov/api/v1/geocode/multiple?apiKey=${apiKey}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      addresses: recordsForGeocoding
    })
  });
  const responseJson = await response.json();

  const geocodingResults = convertGeocodingResultsToLookup(responseJson.result.addresses);

  const newRecords = records.map(record => {
    return {
      ...record,
      ...geocodingResults[record[inputId]]
    };
  });
  // point-in-polygon with sgid table

  // write to new file with additional field name

  const outputFileContents = stringify(newRecords, { header: true });
  fs.writeFileSync(outputFilePath, outputFileContents);
};

const etlRecordsForGeocoding = (records, idField, streetField, zoneField) => {
  return records.map(record => {
    return {
      id: record[idField],
      street: record[streetField],
      zone: record[zoneField]
    };
  });
};

const convertGeocodingResultsToLookup = (results) => {
  const lookup = {};
  results.forEach(result => {
    lookup[result.id] = {
      x: result.location.x,
      y: result.location.y,
      score: result.score,
      locator: result.locator,
      matchAddress: result.matchAddress,
      standardizedAddress: result.standardizedAddress,
      addressGrid: result.addressGrid
    }
  });

  return lookup;
};
