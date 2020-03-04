import './index.css';
import { remote } from 'electron';
import parse from 'csv-parse/lib/sync';
import fs from 'fs';
import stringify from 'csv-stringify/lib/sync';
import path from 'path';
import tag from '@turf/tag';
import proj4 from 'proj4';
import { sortBy } from 'lodash/collection';


const getParameters = () => {
  const inputNodes = Array.from(document.getElementsByTagName('input'))
    .concat(Array.from(document.getElementsByTagName('select')));
  const parameters = {};

  for (let node of inputNodes) {
    parameters[node.id] = node.value;
  };
  console.log('parameters', parameters);

  return parameters;
};

const getOpenDataDatasets = async () => {
  const OpenDataAPI = 'https://opendata.gis.utah.gov/data.json';

  const response = await fetch(OpenDataAPI);
  const responseJson = await response.json();

  const tableNameSelect = document.getElementById('tableName');
  sortBy(responseJson.dataset, ['title']).forEach(dataset => {
    const distribution = dataset.distribution.find(dist => dist.format === 'GeoJSON');
    if (distribution) {
      const option = document.createElement('option');
      option.value = distribution.accessURL;
      option.innerHTML = dataset.title;
      tableNameSelect.appendChild(option);
    }
  });
};
getOpenDataDatasets();

let openDataFeatureSet;
window.loadOpenDataDataset = async () => {
  console.log('loadOpenDataDataset');

  const tableNameSelect = document.getElementById('tableName');
  const response = await fetch(tableNameSelect.value.replace('http', 'https'));
  openDataFeatureSet = await response.json();
  const firstFeature = openDataFeatureSet.features[0];

  loadSelect('fieldName', Object.keys(firstFeature.properties));
};

const loadSelect = (id, values) => {
  const select = document.getElementById(id);
  values.forEach(value => {
    const option = document.createElement('option');
    option.value = value;
    option.innerHTML = value;
    select.appendChild(option);
  });
};

let inputRecords;
let outputFilePath;
window.openFile = () => {
  const filePaths = remote.dialog.showOpenDialogSync();
  console.log('filePaths', filePaths);

  const csvPath = filePaths[0];
  outputFilePath = `${path.dirname(csvPath)}/${path.basename(csvPath, '.csv')}_Attributed.csv`;

  // read records
  const fileContents = fs.readFileSync(csvPath, 'utf8');
  inputRecords = parse(fileContents, {
    columns: true,
    skip_empty_lines: true
  });

  const fields = Object.keys(inputRecords[0]);
  loadSelect('inputId', fields);
  loadSelect('inputStreet', fields);
  loadSelect('inputZone', fields);
}

window.processRecords = async () => {
  const { apiKey, tableName, fieldName, inputId, inputStreet, inputZone } = getParameters();

  const recordsForGeocoding = etlRecordsForGeocoding(inputRecords, inputId, inputStreet, inputZone);
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

  // project geocoding coords (26912) into WGS84 to match polygon data
  const project = proj4('PROJCS["NAD83 / UTM zone 12N",GEOGCS["NAD83",DATUM["North_American_Datum_1983",SPHEROID["GRS 1980",6378137,298.257222101,AUTHORITY["EPSG","7019"]],TOWGS84[0,0,0,0,0,0,0],AUTHORITY["EPSG","6269"]],PRIMEM["Greenwich",0,AUTHORITY["EPSG","8901"]],UNIT["degree",0.0174532925199433,AUTHORITY["EPSG","9122"]],AUTHORITY["EPSG","4269"]],PROJECTION["Transverse_Mercator"],PARAMETER["latitude_of_origin",0],PARAMETER["central_meridian",-111],PARAMETER["scale_factor",0.9996],PARAMETER["false_easting",500000],PARAMETER["false_northing",0],UNIT["metre",1,AUTHORITY["EPSG","9001"]],AXIS["Easting",EAST],AXIS["Northing",NORTH],AUTHORITY["EPSG","26912"]]', 'WGS84').forward;
  const pointsFeatureSet = {
    type: 'FeatureCollection',
    features: responseJson.result.addresses.map(result => {
      return {
        properties: {
          id: result.id
        },
        geometry: {
          type: 'Point',
          coordinates: project([result.location.x, result.location.y])
        }
      }
    })
  };

  // spatial join
  const joined = tag(pointsFeatureSet, openDataFeatureSet, fieldName, fieldName);
  console.log('joined', joined);
  const joinedLookup = convertJoinedToLookup(joined, fieldName);

  const newRecords = inputRecords.map(record => {
    return {
      ...record,
      ...geocodingResults[record[inputId]],
      [fieldName]: joinedLookup[record[inputId]]
    };
  });

  // write to new file with additional field name
  console.log('newRecords', newRecords);

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

const convertJoinedToLookup = (featureSet, fieldName) => {
  const lookup = {};
  featureSet.features.forEach(feature => {
    lookup[feature.properties.id] = feature.properties[fieldName]
  });

  return lookup;
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
