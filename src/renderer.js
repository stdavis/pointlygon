import './index.css';
import { remote } from 'electron';
import parse from 'csv-parse/lib/sync';
import fs from 'fs';
import stringify from 'csv-stringify/lib/sync';
import path from 'path';


window.openFile = () => {
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

  const newRecords = records.map(record => {
    return {
      ...record,
      test: 'a'
    };
  });
  // match records

  // point-in-polygon with sgid table

  // write to new file with additional field name

  const outputFileContents = stringify(newRecords, { header: true });
  fs.writeFileSync(outputFilePath, outputFileContents);
};
