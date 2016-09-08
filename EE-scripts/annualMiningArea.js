/*//////////////////////////////////////////////////////////////////////////////
   This script was created by SkyTruth to identify possible active mountaintop
   removal and other surface coal mining. This script requires an input 
   ImageCollection, generated with the greenestCompositesToAssets script.
   
   We have annual imagery for each year from 1984 - 2016. For 1972 - 1982,
   see this chart for naming conventions for three- or two-year composites.
   Note: 1983 is omitted due to lack of quality imagery (not enough satellite)
   coverage during those years.
   
   Key  = 3-year period
   -------------------
   1972  =   1972-1974
   1975  =   1975-1977
   1978  =   1978-1980
   1981  =   1981-1982

/*------------------ IMPORT GREENEST COMPOSITE FEATURE COLLECTION ----------- */
var greenestComposites = ee.ImageCollection("users/andrewpericak/greenestComposites");

/*------------------------- IMPORT STUDY AREA ------------------------------- */
// https://www.google.com/fusiontables/DataSource?docid=1Lphn5PR9YbneoY4sPkKGMUOJcurihIcCx0J82h7U
var studyArea = ee.FeatureCollection('ft:1Lphn5PR9YbneoY4sPkKGMUOJcurihIcCx0J82h7U');

/*----------------------- ESTABLISH EXPORT AREAS ---------------------------- */

//// FOUR RECTANGULAR REGIONS

// var geometryI = /* color: d63000 */ee.Feature(
//         ee.Geometry.Polygon(
//             [[[-79.612, 39.037],
//               [-79.612, 37.3525],
//               [-82.421, 37.3525],
//               [-82.421, 39.037]]]),
//         {
//           "system:index": "0"
//         }),
//     geometryII = /* color: 98ff00 */ee.Feature(
//         ee.Geometry.Polygon(
//             [[[-82.421, 38.942],
//               [-82.421, 37.3525],
//               [-84.993, 37.3525],
//               [-84.993, 38.942]]]),
//         {
//           "system:index": "0"
//         }),
//     geometryIII = /* color: 0B4A8B */ee.Feature(
//         ee.Geometry.Polygon(
//             [[[-82.421, 37.3525],
//               [-82.421, 35.637],
//               [-85.811, 35.637],
//               [-85.811, 37.3525]]]),
//         {
//           "system:index": "0"
//         }),
//     geometryIV = /* color: ffc82d */ee.Feature(
//         ee.Geometry.Polygon(
//             [[[-79.849, 37.3525],
//               [-79.849, 35.763],
//               [-82.421, 35.763],
//               [-82.421, 37.3525]]]),
//         {
//           "system:index": "0"
//         });
// var features = ee.FeatureCollection([geometryI, geometryII, geometryIII, geometryIV]);

//// BY COUNTY

var fips_codes = [21013,21019,21025,21043,21051,21053,21063,21065,21071,21089,
                  21095,21109,21115,21119,21121,21125,21127,21129,21131,21133,
                  21135,21147,21153,21159,21165,21175,21189,21193,21195,21197,
                  21199,21203,21205,21231,21235,21237,47001,47013,47025,47035,
                  47049,47129,47133,47137,47141,47145,47151,51027,51051,51105,
                  51167,51169,51185,51195,51720,54005,54011,54015,54019,54025,
                  54039,54043,54045,54047,54053,54055,54059,54067,54075,54081,
                  54089,54099,54101,54109];

var allCounties =  ee.FeatureCollection('ft:1S4EB6319wWW2sWQDPhDvmSBIVrD3iEmCLYB7nMM');
var features = allCounties.filter(ee.Filter.inList('FIPS', fips_codes));

// This creates an image where each pixel is labeled with its FIPS code
var countyImg = features.reduceToImage({
  properties: ["FIPS"],
  reducer: ee.Reducer.first()
}).rename("FIPS");

/*------------------------------ IMPORT MASKS --------------------------------*/
var mask_input_60m_2015 = ee.Image('users/jerrilyn/2015mask-PM-fullstudy-area');
// Roads, water bodies, urban areas, etc., buffered 60 m
// Get the link here: https://drive.google.com/file/d/0B_MArPTqurHudFp6STU4ZzJHRmc/view

var miningPermits = ee.Image('users/andrewpericak/allMinePermits');
// All surface mining permits, buffered 1000 m
// Get the link here: https://drive.google.com/file/d/0B_PTuMKVy7beSWdZUkJIS3hneW8/view

var miningPermits_noBuffer = ee.Image('users/andrewpericak/allMinePermits_noBuffer');
// All surface mining permits, without any buffer

// This excludes from the 60 m mask (mask_input_60m_2015) any areas within the
// the mine permit boundaries. Since the 60 m mask is "inversed" (i.e., 0 means
// keep and 1 means eventually mask), this line sets the mine permit areas
// (labeled as 1) to 0.
var mask_input_excludeMines = mask_input_60m_2015.where(miningPermits_noBuffer.eq(1), 0);

// Choose your favorite area of interest! Comment out all but one:
//Map.centerObject(studyArea);        // Full study extent
//Map.setCenter(-81.971744, 38.094253, 12);     // Near Spurlockville, WV
//Map.setCenter(-82.705444, 37.020257, 12);     // Near Addington, VA
//Map.setCenter(-83.224567, 37.355144, 11);     // Near Dice, KY
//Map.setCenter(-83.931184, 36.533646, 12);     // Near Log Mountain, TN


/*------------------------------ MINE ANALYSIS -------------------------------*/

// Below, for each image in the ImageCollection created in the other script,
// determine whether a pixel is or isn't a mine based on NDVI and given
// threshold. Then perform various cleaning algorithms.

//// INITIAL MINE THRESHOLDING

// Create a list of yearly threshold images, and a list of years associated with
// those images, for image selection within the loop
var threshImgList = ee.ImageCollection("users/andrewpericak/annualThresholds")
  .sort("year").toList(100);
var threshImgYrList = ee.List(ee.ImageCollection("users/andrewpericak/annualThresholds")
  .aggregate_array("year")).sort();

// This initially compares the NDVI at each pixel to the given threshold. The
// resulting images are 1 = mine and 0 = non-mine.
var rawMining = ee.ImageCollection(greenestComposites.map(function(image){
  var year = image.get("year");
  var ndvi = image.select("NDVI");
  
  // This pulls the specific threshold image for the given year
  var index = ee.Number(threshImgYrList.indexOf(year));
  var threshold = ee.Image(threshImgList.get(index));
  
  //var threshold = thresholds.get(ee.Number(year).format('%d'));
  // This compares the NDVI per pixel to the NDVI threshold 
  var lowNDVI = ndvi.lte(threshold);//ee.Image.constant(threshold));
  return lowNDVI.set({"year": year});
}));

//// NULL-VALUE CLEANIING

// This is the first step of the null-value cleaning (i.e., where there are no
// pixel values for that year due to cloud cover and a lack of raw imagery.)
// This function first creates a binary image where 1 = values that were null
// in the rawMining image, and where 0 = everything else.
var nullCleaning1 = ee.ImageCollection(rawMining.map(function(image){
  var year = image.get("year");
  var unmasked = image.lt(2).unmask().not().clip(studyArea);
  return unmasked.set({"year": year});
}));

// Create dummy images so the null cleaning will work; essentially for 1983 and
// 2017 (the years immediately before and after the years for which we have
// Landsat scenes), we need images of value 0 so that the nullCleaning2 function
// below actually works. Likewise for any of the MSS years, since we're doing
// those in many years at a time. This means we can't clean any null values from 
// 1984 or 2016 imagery, nor for 1972 - 1982.
var dummy1971 = ee.Image(0).rename("NDVI").set({"year": 1971});
var dummy1973 = ee.Image(0).rename("NDVI").set({"year": 1973});
var dummy1974 = ee.Image(0).rename("NDVI").set({"year": 1974});
var dummy1976 = ee.Image(0).rename("NDVI").set({"year": 1976});
var dummy1977 = ee.Image(0).rename("NDVI").set({"year": 1977});
var dummy1979 = ee.Image(0).rename("NDVI").set({"year": 1979});
var dummy1980 = ee.Image(0).rename("NDVI").set({"year": 1980});
var dummy1982 = ee.Image(0).rename("NDVI").set({"year": 1982});
var dummy1983 = ee.Image(0).rename("NDVI").set({"year": 1983});
var dummy2017 = ee.Image(0).rename("NDVI").set({"year": 2017});

var rawMining2 = ee.ImageCollection(rawMining.merge(ee.ImageCollection(
  [dummy1971,dummy1973,dummy1974,dummy1976,dummy1977,dummy1979,dummy1980,
   dummy1982,dummy1983,dummy2017])));
   
// Create two lists in order to help choose the immediate prior and future
// images for a given year. The first is a list of each image in the rawMining2
// ImageCollection, sorted by year; the second is just a list of each year 
// present in our dataset. These lists, used below, make running the code much
// more efficient than using filterMetadata() or anything like that. Similar 
// lists seen below are achieving the same effect.
var rm2List = rawMining2.sort("year").toList(100);
var rm2YrList = ee.List(rawMining2.aggregate_array("year")).sort();

// This is the second step of the null-value cleaning. For each year, pull the
// raw mining images for the years immediately prior and future, where in those
// images 1 = mine and 0 = non-mine. Add those three images together; areas 
// where the sum is 3 indicate that the null pixel is likely a mine, because
// that pixel was a mine in the prior and future years.
var nullCleaning2 = ee.ImageCollection(nullCleaning1.map(function(image){
  var year = ee.Number(image.get("year"));
  
  var rm2Index = ee.Number(rm2YrList.indexOf(year));
      // I.e., get the index of whatever year we're looking at
  var priorIndex = rm2Index.subtract(1);
      // The previous year index
  var futureIndex = rm2Index.add(1);
      // The future year index
  var imgPrevious = ee.Image(rm2List.get(priorIndex));
  var imgNext = ee.Image(rm2List.get(futureIndex));
      // Since the indices are the same for rm2List and rm2YrList, essentially
      // use the index of the year to select the corresponding image, which has
      // the same index.

  var summation = image.add(imgPrevious).add(imgNext);
  var potentialMine = summation.eq(3);
      // In other words, if a null in current year (1) and a mine in past and
      // future years (also 1), the pixel in the current year will sum to 3
  return potentialMine.set({"year": year});
}));
var nc2List = nullCleaning2.sort("year").toList(100);
var nc2YrList = ee.List(nullCleaning2.aggregate_array("year")).sort();

// This is the third step of the null-value cleaning. Use the results of the
// previous operation to turn any null values in the rawMining imagery into a
// value of 1 if they were also a value of 1 from the nullCleaning2 imagery.

var nullCleaning3 = ee.ImageCollection(rawMining.map(function(image){
  var year = image.get("year");
  var nc2Index = ee.Number(nc2YrList.indexOf(year)); // See explanation above
  var cleaningImg = ee.Image(nc2List.get(nc2Index));
  var updatedRaw = image.unmask().add(cleaningImg);
  return updatedRaw.set({"year": year});
}));

//// NOISE CLEANING

// Now we have noise cleaning, to eliminate pixels that go from unmined->mine->
// unmined, since the mine pixel is likely incorrect

// Again we need dummy years for years without LS coverage, except this time
// the dummy images have values of 1 because otherwise all the pixels near these
// years would get removed
var dummy1971a = ee.Image(1).rename("NDVI").set({"year": 1971});
var dummy1973a = ee.Image(1).rename("NDVI").set({"year": 1973});
var dummy1974a = ee.Image(1).rename("NDVI").set({"year": 1974});
var dummy1976a = ee.Image(1).rename("NDVI").set({"year": 1976});
var dummy1977a = ee.Image(1).rename("NDVI").set({"year": 1977});
var dummy1979a = ee.Image(1).rename("NDVI").set({"year": 1979});
var dummy1980a = ee.Image(1).rename("NDVI").set({"year": 1980});
var dummy1982a = ee.Image(1).rename("NDVI").set({"year": 1982});
var dummy1983a = ee.Image(1).rename("NDVI").set({"year": 1983});
var dummy2017a = ee.Image(1).rename("NDVI").set({"year": 2017});

var rawMining3 = ee.ImageCollection(nullCleaning3.merge(ee.ImageCollection(
  [dummy1971a,dummy1973a,dummy1974a,dummy1976a,dummy1977a,dummy1979a,dummy1980a,
   dummy1982a,dummy1983a,dummy2017a])));
var rm3List = rawMining3.sort("year").toList(100); // See explanation above
var rm3YrList = ee.List(rawMining3.aggregate_array("year")).sort();

var noiseCleaning = ee.ImageCollection(nullCleaning3.map(function(image){
  var year = ee.Number(image.get("year"));

  var rm3Index = ee.Number(rm3YrList.indexOf(year));
  var priorIndex = rm3Index.subtract(1);
  var futureIndex = rm3Index.add(1);
  var imgPrevious = ee.Image(rm3List.get(priorIndex));
  var imgNext = ee.Image(rm3List.get(futureIndex));
  
  // Relabel images so that pixels that are mine in current year but not mine
  // in previous/next years are labeled 111 when summed
  var relabelPrevious = imgPrevious.remap([0,1],[100,-10]);
  var relabelNext = imgNext.remap([0,1],[10,-10]);
  
  var summation = image.add(relabelPrevious).add(relabelNext);
  var potentialNoise = summation.eq(111);
      // Mine in current year = 1; non-mine in past year = 100; non-mine in 
      // future year = 10; therefore we want sum of 111
  return image.where(potentialNoise.eq(1),0).set({"year":year});
}));

//// FINAL CLEANING AND OUTPUT

// This final function performs other cleaning (mask, erosion/dilation, mine 
// permit boundaries) to further clean up the mining dataset.
var mining = ee.ImageCollection(noiseCleaning.map(function(image){
  
  var year = ee.Number(image.get("year"));
  // Create binary image containing the intersection between the LowNDVI and 
  // anywhere the inverted mask is 0
  var mtr = image.and(mask_input_excludeMines.eq(0));
  
  // Erode/dilate MTR sites to remove outliers (pixel clean-up)
  // var mtrCleaned = mtr
  //   .reduceNeighborhood(ee.Reducer.min(), ee.Kernel.euclidean(30, 'meters'))  // erode
  //   .reduceNeighborhood(ee.Reducer.max(), ee.Kernel.euclidean(60, 'meters'))  // dilate
  //   .reduceNeighborhood(ee.Reducer.min(), ee.Kernel.euclidean(30, 'meters')); // erode
  var mtrCleaned = mtr;

  // Mask MTR by the erosion/dilation, and by mining permit locations buffered 
  // out 1 km
  var mtrMasked = mtrCleaned.updateMask(mtrCleaned.and(miningPermits))
      .multiply(year).rename('MTR').toInt();
  
  // Compute area per pixel
  var area = ee.Image.pixelArea().multiply(mtrMasked).divide(year).rename('area').toFloat();
  
  return image.addBands(mtrMasked).addBands(area).addBands(countyImg)
    .select(["MTR","area","FIPS"]);
}));

/*------------ SUMMARIZE MINING AREA PER FEATURE PER YEAR --------------------*/

// This creates a table listing the area of active mining per year, per 
// subregion noted above (to allow this to actually export)
var getFeatures = function(feature) {
  // collection is a collection of removal by year
  var fips = feature.get("FIPS");
  return mining.map(function(image) {
    var yearlyArea = image.select('area').reduceRegion({
      reducer: 'sum', 
      geometry: feature.geometry(), 
      scale: 30,
      maxPixels: 1e10
    });
    return image.set(yearlyArea).set({"FIPS": fips});
  });
};
var miningArea = features.map(getFeatures).flatten();

// This will export the table to your Google Drive
Export.table.toDrive({
  collection: miningArea,
  description: "yearlyActiveMiningArea",
  fileFormat: "csv"
});

/*--------------------------- EXPORT TO VECTORS ------------------------------*/
// IN PROGRESS

var testCounty = 21013;
var testYr = 1985;
var testGeo = features.filterMetadata("FIPS","equals",testCounty).geometry();
var testImg = ee.Image(mining.filterMetadata("year","equals",testYr).first())
  .select("MTR","area"); // Can't export FIPS if we want summed area...

var vectors = testImg.reduceToVectors({
  reducer: ee.Reducer.sum(),  // Each polygon will have sum of its area
  geometry: testGeo,
  scale: 30,
  labelProperty: "year",
  maxPixels: 1e10,
});

Export.table.toDrive({
  collection: vectors,
  description: "vectors_1985_21013",
  fileFormat: "kml"
});

/*---------------------------- EXPORT TO IMAGES ------------------------------*/
// IN PROGRESS

var img85 = ee.Image(mining.filterMetadata("year","equals",1985).first())
  .select(["area","FIPS"]).cast({"area":"float","FIPS":"float"});

Export.image.toDrive({
  image: img85,
  description: "imageExport_1985",
  region: studyArea.geometry(),
  scale: 30,
  maxPixels: 1e10
});






Map.addLayer(greenestComposites.filterMetadata("year","equals",2012),
  {bands:["NDVI"], min:0, max:0.8})
  
// Map.addLayer(mining
//   .filterMetadata("year","equals",2012), 
//   {bands:["MTR"], min:2012, max:2012});

//Map.addLayer(mining, {bands:["MTR"], min:1972, max:2016});
