import { ethers } from "hardhat";

const seriesData = [
  {
    seriesName: "HunterxHunter",
    price: ethers.parseEther("0"), // Example price in Ether
    revealTime: Math.floor(Date.now() / 1000), // Current time
    exchangeTokenURI: "https://lime-basic-thrush-351.mypinata.cloud/ipfs/QmSsdZVZrDbTWc8W2C3rEJ2DRH3yWRpJP9UUEr77tw4mFo/",
    unrevealTokenURI: "https://lime-basic-thrush-351.mypinata.cloud/ipfs/QmSWb9qNc46gQWQop5N27jF68Tdmd4VH1F1rCT3czxxUzQ/0",
    revealTokenURI: "https://lime-basic-thrush-351.mypinata.cloud/ipfs/QmRkTPoSoWAzJMfqqNHtpJ1Lr6HLcuMCE2V4JsRuvtaLpj/",
    seriesMetaDataURI: "https://lime-basic-thrush-351.mypinata.cloud/ipfs/QmYxweAJixyVVAeQeGf6y8CVk4GmUBTfNiVJvusgcaUuMU/series0.json",
    prizes: [
      // Assuming Prize is a struct with fields like name and remainingQuantity
      { name: "A", remainingQuantity: 2 },
      { name: "B", remainingQuantity: 2 },
      { name: "C", remainingQuantity: 3 },
      { name: "D", remainingQuantity: 3 },
      { name: "E", remainingQuantity: 15 },
      { name: "F", remainingQuantity: 20 },
      { name: "G", remainingQuantity: 25 },
    ],
  },
  // Repeat for other series...
  {
    seriesName: "JOJO",
    price: ethers.parseEther("0"), // Example price in Ether
    revealTime: Math.floor(Date.now() / 1000), // Current time
    exchangeTokenURI: "https://lime-basic-thrush-351.mypinata.cloud/ipfs/QmaoRXEHHeNUW57rTP17MuNf56qrEVRtEFtopKK598KEqt/",
    unrevealTokenURI: "https://lime-basic-thrush-351.mypinata.cloud/ipfs/QmSWb9qNc46gQWQop5N27jF68Tdmd4VH1F1rCT3czxxUzQ/0",
    revealTokenURI: "https://lime-basic-thrush-351.mypinata.cloud/ipfs/QmPuJZzKS5aVc267sSVACeqBChmuPCNV6CgzFrZniENB7Z/",
    seriesMetaDataURI: "https://lime-basic-thrush-351.mypinata.cloud/ipfs/QmYxweAJixyVVAeQeGf6y8CVk4GmUBTfNiVJvusgcaUuMU/series1.json",
    prizes: [
      // Assuming Prize is a struct with fields like name and remainingQuantity
      { name: "A", remainingQuantity: 2 },
      { name: "B", remainingQuantity: 2 },
      { name: "C", remainingQuantity: 3 },
      { name: "D", remainingQuantity: 3 },
      { name: "E", remainingQuantity: 15 },
      { name: "F", remainingQuantity: 20 },
      { name: "G", remainingQuantity: 25 },
    ],
  },
  // Help me to repeat this two series for 15 series, one is HunterxHunter and the other is JOJO
  {
    seriesName: "HunterxHunter",
    price: ethers.parseEther("0"), // Example price in Ether
    revealTime: Math.floor(Date.now() / 1000), // Current time
    exchangeTokenURI: "https://lime-basic-thrush-351.mypinata.cloud/ipfs/QmSsdZVZrDbTWc8W2C3rEJ2DRH3yWRpJP9UUEr77tw4mFo/",
    unrevealTokenURI: "https://lime-basic-thrush-351.mypinata.cloud/ipfs/QmSWb9qNc46gQWQop5N27jF68Tdmd4VH1F1rCT3czxxUzQ/0",
    revealTokenURI: "https://lime-basic-thrush-351.mypinata.cloud/ipfs/QmRkTPoSoWAzJMfqqNHtpJ1Lr6HLcuMCE2V4JsRuvtaLpj/",
    seriesMetaDataURI: "https://lime-basic-thrush-351.mypinata.cloud/ipfs/QmYxweAJixyVVAeQeGf6y8CVk4GmUBTfNiVJvusgcaUuMU/series2.json",
    prizes: [
      // Assuming Prize is a struct with fields like name and remainingQuantity
      { name: "A", remainingQuantity: 2 },
      { name: "B", remainingQuantity: 2 },
      { name: "C", remainingQuantity: 3 },
      { name: "D", remainingQuantity: 3 },
      { name: "E", remainingQuantity: 15 },
      { name: "F", remainingQuantity: 20 },
      { name: "G", remainingQuantity: 25 },
    ],
  },
  {
    seriesName: "JOJO",
    price: ethers.parseEther("0"), // Example price in Ether
    revealTime: Math.floor(Date.now() / 1000), // Current time
    exchangeTokenURI: "https://lime-basic-thrush-351.mypinata.cloud/ipfs/QmaoRXEHHeNUW57rTP17MuNf56qrEVRtEFtopKK598KEqt/",
    unrevealTokenURI: "https://lime-basic-thrush-351.mypinata.cloud/ipfs/QmSWb9qNc46gQWQop5N27jF68Tdmd4VH1F1rCT3czxxUzQ/0",
    revealTokenURI: "https://lime-basic-thrush-351.mypinata.cloud/ipfs/QmPuJZzKS5aVc267sSVACeqBChmuPCNV6CgzFrZniENB7Z/",
    seriesMetaDataURI: "https://lime-basic-thrush-351.mypinata.cloud/ipfs/QmYxweAJixyVVAeQeGf6y8CVk4GmUBTfNiVJvusgcaUuMU/series3.json",
    prizes: [
      // Assuming Prize is a struct with fields like name and remainingQuantity
      { name: "A", remainingQuantity: 2 },
      { name: "B", remainingQuantity: 2 },
      { name: "C", remainingQuantity: 3 },
      { name: "D", remainingQuantity: 3 },
      { name: "E", remainingQuantity: 15 },
      { name: "F", remainingQuantity: 20 },
      { name: "G", remainingQuantity: 25 },
    ],
  },
  {
    seriesName: "HunterxHunter",
    price: ethers.parseEther("0"), // Example price in Ether
    revealTime: Math.floor(Date.now() / 1000), // Current time
    exchangeTokenURI: "https://lime-basic-thrush-351.mypinata.cloud/ipfs/QmSsdZVZrDbTWc8W2C3rEJ2DRH3yWRpJP9UUEr77tw4mFo/",
    unrevealTokenURI: "https://lime-basic-thrush-351.mypinata.cloud/ipfs/QmSWb9qNc46gQWQop5N27jF68Tdmd4VH1F1rCT3czxxUzQ/0",
    revealTokenURI: "https://lime-basic-thrush-351.mypinata.cloud/ipfs/QmRkTPoSoWAzJMfqqNHtpJ1Lr6HLcuMCE2V4JsRuvtaLpj/",
    seriesMetaDataURI: "https://lime-basic-thrush-351.mypinata.cloud/ipfs/QmYxweAJixyVVAeQeGf6y8CVk4GmUBTfNiVJvusgcaUuMU/series4.json",
    prizes: [
      // Assuming Prize is a struct with fields like name and remainingQuantity
      { name: "A", remainingQuantity: 2 },
      { name: "B", remainingQuantity: 2 },
      { name: "C", remainingQuantity: 3 },
      { name: "D", remainingQuantity: 3 },
      { name: "E", remainingQuantity: 15 },
      { name: "F", remainingQuantity: 20 },
      { name: "G", remainingQuantity: 25 },
    ],
  },
  // Repeat for other series...
  {
    seriesName: "JOJO",
    price: ethers.parseEther("0"), // Example price in Ether
    revealTime: Math.floor(Date.now() / 1000), // Current time
    exchangeTokenURI: "https://lime-basic-thrush-351.mypinata.cloud/ipfs/QmaoRXEHHeNUW57rTP17MuNf56qrEVRtEFtopKK598KEqt/",
    unrevealTokenURI: "https://lime-basic-thrush-351.mypinata.cloud/ipfs/QmSWb9qNc46gQWQop5N27jF68Tdmd4VH1F1rCT3czxxUzQ/0",
    revealTokenURI: "https://lime-basic-thrush-351.mypinata.cloud/ipfs/QmPuJZzKS5aVc267sSVACeqBChmuPCNV6CgzFrZniENB7Z/",
    seriesMetaDataURI: "https://lime-basic-thrush-351.mypinata.cloud/ipfs/QmYxweAJixyVVAeQeGf6y8CVk4GmUBTfNiVJvusgcaUuMU/series5.json",
    prizes: [
      // Assuming Prize is a struct with fields like name and remainingQuantity
      { name: "A", remainingQuantity: 2 },
      { name: "B", remainingQuantity: 2 },
      { name: "C", remainingQuantity: 3 },
      { name: "D", remainingQuantity: 3 },
      { name: "E", remainingQuantity: 15 },
      { name: "F", remainingQuantity: 20 },
      { name: "G", remainingQuantity: 25 },
    ],
  },  {
    seriesName: "HunterxHunter",
    price: ethers.parseEther("0"), // Example price in Ether
    revealTime: Math.floor(Date.now() / 1000), // Current time
    exchangeTokenURI: "https://lime-basic-thrush-351.mypinata.cloud/ipfs/QmSsdZVZrDbTWc8W2C3rEJ2DRH3yWRpJP9UUEr77tw4mFo/",
    unrevealTokenURI: "https://lime-basic-thrush-351.mypinata.cloud/ipfs/QmSWb9qNc46gQWQop5N27jF68Tdmd4VH1F1rCT3czxxUzQ/0",
    revealTokenURI: "https://lime-basic-thrush-351.mypinata.cloud/ipfs/QmRkTPoSoWAzJMfqqNHtpJ1Lr6HLcuMCE2V4JsRuvtaLpj/",
    seriesMetaDataURI: "https://lime-basic-thrush-351.mypinata.cloud/ipfs/QmYxweAJixyVVAeQeGf6y8CVk4GmUBTfNiVJvusgcaUuMU/series6.json",
    prizes: [
      // Assuming Prize is a struct with fields like name and remainingQuantity
      { name: "A", remainingQuantity: 2 },
      { name: "B", remainingQuantity: 2 },
      { name: "C", remainingQuantity: 3 },
      { name: "D", remainingQuantity: 3 },
      { name: "E", remainingQuantity: 15 },
      { name: "F", remainingQuantity: 20 },
      { name: "G", remainingQuantity: 25 },
    ],
  },
  // Repeat for other series...
  {
    seriesName: "JOJO",
    price: ethers.parseEther("0"), // Example price in Ether
    revealTime: Math.floor(Date.now() / 1000), // Current time
    exchangeTokenURI: "https://lime-basic-thrush-351.mypinata.cloud/ipfs/QmaoRXEHHeNUW57rTP17MuNf56qrEVRtEFtopKK598KEqt/",
    unrevealTokenURI: "https://lime-basic-thrush-351.mypinata.cloud/ipfs/QmSWb9qNc46gQWQop5N27jF68Tdmd4VH1F1rCT3czxxUzQ/0",
    revealTokenURI: "https://lime-basic-thrush-351.mypinata.cloud/ipfs/QmPuJZzKS5aVc267sSVACeqBChmuPCNV6CgzFrZniENB7Z/",
    seriesMetaDataURI: "https://lime-basic-thrush-351.mypinata.cloud/ipfs/QmYxweAJixyVVAeQeGf6y8CVk4GmUBTfNiVJvusgcaUuMU/series7.json",
    prizes: [
      // Assuming Prize is a struct with fields like name and remainingQuantity
      { name: "A", remainingQuantity: 2 },
      { name: "B", remainingQuantity: 2 },
      { name: "C", remainingQuantity: 3 },
      { name: "D", remainingQuantity: 3 },
      { name: "E", remainingQuantity: 15 },
      { name: "F", remainingQuantity: 20 },
      { name: "G", remainingQuantity: 25 },
    ],
  },  {
    seriesName: "HunterxHunter",
    price: ethers.parseEther("0"), // Example price in Ether
    revealTime: Math.floor(Date.now() / 1000), // Current time
    exchangeTokenURI: "https://lime-basic-thrush-351.mypinata.cloud/ipfs/QmSsdZVZrDbTWc8W2C3rEJ2DRH3yWRpJP9UUEr77tw4mFo/",
    unrevealTokenURI: "https://lime-basic-thrush-351.mypinata.cloud/ipfs/QmSWb9qNc46gQWQop5N27jF68Tdmd4VH1F1rCT3czxxUzQ/0",
    revealTokenURI: "https://lime-basic-thrush-351.mypinata.cloud/ipfs/QmRkTPoSoWAzJMfqqNHtpJ1Lr6HLcuMCE2V4JsRuvtaLpj/",
    seriesMetaDataURI: "https://lime-basic-thrush-351.mypinata.cloud/ipfs/QmYxweAJixyVVAeQeGf6y8CVk4GmUBTfNiVJvusgcaUuMU/series8.json",
    prizes: [
      // Assuming Prize is a struct with fields like name and remainingQuantity
      { name: "A", remainingQuantity: 2 },
      { name: "B", remainingQuantity: 2 },
      { name: "C", remainingQuantity: 3 },
      { name: "D", remainingQuantity: 3 },
      { name: "E", remainingQuantity: 15 },
      { name: "F", remainingQuantity: 20 },
      { name: "G", remainingQuantity: 25 },
    ],
  },
  // Repeat for other series...
  {
    seriesName: "JOJO",
    price: ethers.parseEther("0"), // Example price in Ether
    revealTime: Math.floor(Date.now() / 1000), // Current time
    exchangeTokenURI: "https://lime-basic-thrush-351.mypinata.cloud/ipfs/QmaoRXEHHeNUW57rTP17MuNf56qrEVRtEFtopKK598KEqt/",
    unrevealTokenURI: "https://lime-basic-thrush-351.mypinata.cloud/ipfs/QmSWb9qNc46gQWQop5N27jF68Tdmd4VH1F1rCT3czxxUzQ/0",
    revealTokenURI: "https://lime-basic-thrush-351.mypinata.cloud/ipfs/QmPuJZzKS5aVc267sSVACeqBChmuPCNV6CgzFrZniENB7Z/",
    seriesMetaDataURI: "https://lime-basic-thrush-351.mypinata.cloud/ipfs/QmYxweAJixyVVAeQeGf6y8CVk4GmUBTfNiVJvusgcaUuMU/series9.json",
    prizes: [
      // Assuming Prize is a struct with fields like name and remainingQuantity
      { name: "A", remainingQuantity: 2 },
      { name: "B", remainingQuantity: 2 },
      { name: "C", remainingQuantity: 3 },
      { name: "D", remainingQuantity: 3 },
      { name: "E", remainingQuantity: 15 },
      { name: "F", remainingQuantity: 20 },
      { name: "G", remainingQuantity: 25 },
    ],
  },  {
    seriesName: "HunterxHunter",
    price: ethers.parseEther("0"), // Example price in Ether
    revealTime: Math.floor(Date.now() / 1000), // Current time
    exchangeTokenURI: "https://lime-basic-thrush-351.mypinata.cloud/ipfs/QmSsdZVZrDbTWc8W2C3rEJ2DRH3yWRpJP9UUEr77tw4mFo/",
    unrevealTokenURI: "https://lime-basic-thrush-351.mypinata.cloud/ipfs/QmSWb9qNc46gQWQop5N27jF68Tdmd4VH1F1rCT3czxxUzQ/0",
    revealTokenURI: "https://lime-basic-thrush-351.mypinata.cloud/ipfs/QmRkTPoSoWAzJMfqqNHtpJ1Lr6HLcuMCE2V4JsRuvtaLpj/",
    seriesMetaDataURI: "https://lime-basic-thrush-351.mypinata.cloud/ipfs/QmYxweAJixyVVAeQeGf6y8CVk4GmUBTfNiVJvusgcaUuMU/series10.json",
    prizes: [
      // Assuming Prize is a struct with fields like name and remainingQuantity
      { name: "A", remainingQuantity: 2 },
      { name: "B", remainingQuantity: 2 },
      { name: "C", remainingQuantity: 3 },
      { name: "D", remainingQuantity: 3 },
      { name: "E", remainingQuantity: 15 },
      { name: "F", remainingQuantity: 20 },
      { name: "G", remainingQuantity: 25 },
    ],
  },
  // Repeat for other series...
  {
    seriesName: "JOJO",
    price: ethers.parseEther("0"), // Example price in Ether
    revealTime: Math.floor(Date.now() / 1000), // Current time
    exchangeTokenURI: "https://lime-basic-thrush-351.mypinata.cloud/ipfs/QmaoRXEHHeNUW57rTP17MuNf56qrEVRtEFtopKK598KEqt/",
    unrevealTokenURI: "https://lime-basic-thrush-351.mypinata.cloud/ipfs/QmSWb9qNc46gQWQop5N27jF68Tdmd4VH1F1rCT3czxxUzQ/0",
    revealTokenURI: "https://lime-basic-thrush-351.mypinata.cloud/ipfs/QmPuJZzKS5aVc267sSVACeqBChmuPCNV6CgzFrZniENB7Z/",
    seriesMetaDataURI: "https://lime-basic-thrush-351.mypinata.cloud/ipfs/QmYxweAJixyVVAeQeGf6y8CVk4GmUBTfNiVJvusgcaUuMU/series11.json",
    prizes: [
      // Assuming Prize is a struct with fields like name and remainingQuantity
      { name: "A", remainingQuantity: 2 },
      { name: "B", remainingQuantity: 2 },
      { name: "C", remainingQuantity: 3 },
      { name: "D", remainingQuantity: 3 },
      { name: "E", remainingQuantity: 15 },
      { name: "F", remainingQuantity: 20 },
      { name: "G", remainingQuantity: 25 },
    ],
  },  {
    seriesName: "HunterxHunter",
    price: ethers.parseEther("0"), // Example price in Ether
    revealTime: Math.floor(Date.now() / 1000), // Current time
    exchangeTokenURI: "https://lime-basic-thrush-351.mypinata.cloud/ipfs/QmSsdZVZrDbTWc8W2C3rEJ2DRH3yWRpJP9UUEr77tw4mFo/",
    unrevealTokenURI: "https://lime-basic-thrush-351.mypinata.cloud/ipfs/QmSWb9qNc46gQWQop5N27jF68Tdmd4VH1F1rCT3czxxUzQ/0",
    revealTokenURI: "https://lime-basic-thrush-351.mypinata.cloud/ipfs/QmRkTPoSoWAzJMfqqNHtpJ1Lr6HLcuMCE2V4JsRuvtaLpj/",
    seriesMetaDataURI: "https://lime-basic-thrush-351.mypinata.cloud/ipfs/QmYxweAJixyVVAeQeGf6y8CVk4GmUBTfNiVJvusgcaUuMU/series12.json",
    prizes: [
      // Assuming Prize is a struct with fields like name and remainingQuantity
      { name: "A", remainingQuantity: 2 },
      { name: "B", remainingQuantity: 2 },
      { name: "C", remainingQuantity: 3 },
      { name: "D", remainingQuantity: 3 },
      { name: "E", remainingQuantity: 15 },
      { name: "F", remainingQuantity: 20 },
      { name: "G", remainingQuantity: 25 },
    ],
  },
  // Repeat for other series...
  {
    seriesName: "JOJO",
    price: ethers.parseEther("0"), // Example price in Ether
    revealTime: Math.floor(Date.now() / 1000), // Current time
    exchangeTokenURI: "https://lime-basic-thrush-351.mypinata.cloud/ipfs/QmaoRXEHHeNUW57rTP17MuNf56qrEVRtEFtopKK598KEqt/",
    unrevealTokenURI: "https://lime-basic-thrush-351.mypinata.cloud/ipfs/QmSWb9qNc46gQWQop5N27jF68Tdmd4VH1F1rCT3czxxUzQ/0",
    revealTokenURI: "https://lime-basic-thrush-351.mypinata.cloud/ipfs/QmPuJZzKS5aVc267sSVACeqBChmuPCNV6CgzFrZniENB7Z/",
    seriesMetaDataURI: "https://lime-basic-thrush-351.mypinata.cloud/ipfs/QmYxweAJixyVVAeQeGf6y8CVk4GmUBTfNiVJvusgcaUuMU/series13.json",
    prizes: [
      // Assuming Prize is a struct with fields like name and remainingQuantity
      { name: "A", remainingQuantity: 2 },
      { name: "B", remainingQuantity: 2 },
      { name: "C", remainingQuantity: 3 },
      { name: "D", remainingQuantity: 3 },
      { name: "E", remainingQuantity: 15 },
      { name: "F", remainingQuantity: 20 },
      { name: "G", remainingQuantity: 25 },
    ],
  },  {
    seriesName: "HunterxHunter",
    price: ethers.parseEther("0"), // Example price in Ether
    revealTime: Math.floor(Date.now() / 1000), // Current time
    exchangeTokenURI: "https://lime-basic-thrush-351.mypinata.cloud/ipfs/QmSsdZVZrDbTWc8W2C3rEJ2DRH3yWRpJP9UUEr77tw4mFo/",
    unrevealTokenURI: "https://lime-basic-thrush-351.mypinata.cloud/ipfs/QmSWb9qNc46gQWQop5N27jF68Tdmd4VH1F1rCT3czxxUzQ/0",
    revealTokenURI: "https://lime-basic-thrush-351.mypinata.cloud/ipfs/QmRkTPoSoWAzJMfqqNHtpJ1Lr6HLcuMCE2V4JsRuvtaLpj/",
    seriesMetaDataURI: "https://lime-basic-thrush-351.mypinata.cloud/ipfs/QmYxweAJixyVVAeQeGf6y8CVk4GmUBTfNiVJvusgcaUuMU/series14.json",
    prizes: [
      // Assuming Prize is a struct with fields like name and remainingQuantity
      { name: "A", remainingQuantity: 2 },
      { name: "B", remainingQuantity: 2 },
      { name: "C", remainingQuantity: 3 },
      { name: "D", remainingQuantity: 3 },
      { name: "E", remainingQuantity: 15 },
      { name: "F", remainingQuantity: 20 },
      { name: "G", remainingQuantity: 25 },
    ],
  },
  // Repeat for other series...
  {
    seriesName: "JOJO",
    price: ethers.parseEther("0"), // Example price in Ether
    revealTime: Math.floor(Date.now() / 1000), // Current time
    exchangeTokenURI: "https://lime-basic-thrush-351.mypinata.cloud/ipfs/QmaoRXEHHeNUW57rTP17MuNf56qrEVRtEFtopKK598KEqt/",
    unrevealTokenURI: "https://lime-basic-thrush-351.mypinata.cloud/ipfs/QmSWb9qNc46gQWQop5N27jF68Tdmd4VH1F1rCT3czxxUzQ/0",
    revealTokenURI: "https://lime-basic-thrush-351.mypinata.cloud/ipfs/QmPuJZzKS5aVc267sSVACeqBChmuPCNV6CgzFrZniENB7Z/",
    seriesMetaDataURI: "https://lime-basic-thrush-351.mypinata.cloud/ipfs/QmYxweAJixyVVAeQeGf6y8CVk4GmUBTfNiVJvusgcaUuMU/series15.json",
    prizes: [
      // Assuming Prize is a struct with fields like name and remainingQuantity
      { name: "A", remainingQuantity: 2 },
      { name: "B", remainingQuantity: 2 },
      { name: "C", remainingQuantity: 3 },
      { name: "D", remainingQuantity: 3 },
      { name: "E", remainingQuantity: 15 },
      { name: "F", remainingQuantity: 20 },
      { name: "G", remainingQuantity: 25 },
    ],
  },
];

async function main() {
  // Deploy the contract
  const ICHICHAINFactory = await ethers.getContractFactory("ICHICHAIN");
  const ICHICHAINContract = await ICHICHAINFactory.deploy(
    process.env.LINK_SUBSCRIPTIONS || "",
    process.env.LINK_TOKEN || ""
  );
  await ICHICHAINContract.waitForDeployment();

  console.log("Contract deployed to:", ICHICHAINContract.target);

  // Create each series
  for (const series of seriesData) {
    // Convert Prize[] structure to match your contract's expectations
    const prizes = series.prizes.map(prize => {
      // Adapt this part based on your contract's Prize struct
      return {
        prizeName: prize.name,
        prizeRemainingQuantity: prize.remainingQuantity,
      };
    });

    await ICHICHAINContract.createSeries(
      series.seriesName,
      series.price,
      series.revealTime,
      series.exchangeTokenURI,
      series.unrevealTokenURI,
      series.revealTokenURI,
      series.seriesMetaDataURI,
      prizes
    );
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
