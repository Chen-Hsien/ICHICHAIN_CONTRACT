import { ethers } from "hardhat";

const secondsInADay = 86400;

const seriesData = [
  // {
  //   seriesName: "HunterxHunter",
  //   price: ethers.parseEther("0"), // Example price in Ether
  //   // Current time + 1 day
  //   estimateDeliverTime: Math.floor(Date.now() / 1000),
  //   exchangeTokenURI:
  //     "https://lime-basic-thrush-351.mypinata.cloud/ipfs/QmdsHZtT989VEXkhtU3M2fMVRua43YNvqayutT1AoBiQ2c/",
  //   unrevealTokenURI:
  //     "https://lime-basic-thrush-351.mypinata.cloud/ipfs/QmSWb9qNc46gQWQop5N27jF68Tdmd4VH1F1rCT3czxxUzQ/0",
  //   revealTokenURI:
  //     "https://lime-basic-thrush-351.mypinata.cloud/ipfs/QmV3HW1ygbq65ATckXx1v57qPf6M31p77qzVvsjwdS7X2t/",
  //   seriesMetaDataURI:
  //     "https://lime-basic-thrush-351.mypinata.cloud/ipfs/QmRJEuZA55okBADVeoK2Fd6Uy5CRHEBNn2DumXKpZnxN9A/series0.json",
  //   prizes: [
  //     { subPrizeID: 1, prizeGroup: "A", subPrizeName: "A1", subPrizeRemainingQuantity: 2 },
  //     { subPrizeID: 2, prizeGroup: "B", subPrizeName: "B1", subPrizeRemainingQuantity: 2 },
  //     { subPrizeID: 3, prizeGroup: "C", subPrizeName: "C1", subPrizeRemainingQuantity: 3 },
  //     { subPrizeID: 4, prizeGroup: "D", subPrizeName: "D1", subPrizeRemainingQuantity: 3 },
  //     { subPrizeID: 5, prizeGroup: "E", subPrizeName: "E1", subPrizeRemainingQuantity: 5 },
  //     { subPrizeID: 6, prizeGroup: "E", subPrizeName: "E2", subPrizeRemainingQuantity: 5 },
  //     { subPrizeID: 7, prizeGroup: "E", subPrizeName: "E3", subPrizeRemainingQuantity: 5 },
  //     { subPrizeID: 8, prizeGroup: "F", subPrizeName: "F1", subPrizeRemainingQuantity: 5 },
  //     { subPrizeID: 9, prizeGroup: "F", subPrizeName: "F2", subPrizeRemainingQuantity: 5 },
  //     { subPrizeID: 10, prizeGroup: "F", subPrizeName: "F3", subPrizeRemainingQuantity: 5 },
  //     { subPrizeID: 11, prizeGroup: "F", subPrizeName: "F3", subPrizeRemainingQuantity: 5 },
  //     { subPrizeID: 12, prizeGroup: "G", subPrizeName: "G1", subPrizeRemainingQuantity: 5 },
  //     { subPrizeID: 13, prizeGroup: "G", subPrizeName: "G2", subPrizeRemainingQuantity: 5 },
  //     { subPrizeID: 14, prizeGroup: "G", subPrizeName: "G3", subPrizeRemainingQuantity: 5 },
  //     { subPrizeID: 15, prizeGroup: "G", subPrizeName: "G4", subPrizeRemainingQuantity: 10 }
  //   ],
  // },
  // Repeat for other series...
  {
    seriesName: "YU-GI-OH! SERIES VOL.3",
    price: ethers.parseEther("10"), // Example price in Ether
    priceInTWD: 300,
    estimateDeliverTime: Math.floor(Date.now() / 1000),
    totalPrizeQuantity: 80,
    exchangeTokenURI:
      "https://lime-basic-thrush-351.mypinata.cloud/ipfs/QmcPrzGkq1DKDDrQ1NpXxYJBhRDGrpp4H1hdfz62mJm3yG/",
    unrevealTokenURI:
      "https://lime-basic-thrush-351.mypinata.cloud/ipfs/QmYqPLb3bUowPsMa3hXz5mosBW6N1zmut2PNuh5GuQWfQj/1",
    revealTokenURI:
      "https://lime-basic-thrush-351.mypinata.cloud/ipfs/QmSV7FFzoY9iNCeu874HxVKCCgZ9yXraE7LSqDhdKUbRUp/",
    seriesMetaDataURI:
      "https://lime-basic-thrush-351.mypinata.cloud/ipfs/QmVo7xG7d9iXn3yn5K9oXKxzgu4fC7tJoNESjcFWZ8u6Uz",
    prizes: [
      {
        subPrizeID: 1,
        prizeGroup: "A",
        subPrizeName: "A1",
        subPrizeRemainingQuantity: 2,
      },
      {
        subPrizeID: 2,
        prizeGroup: "B",
        subPrizeName: "B1",
        subPrizeRemainingQuantity: 2,
      },
      {
        subPrizeID: 3,
        prizeGroup: "C",
        subPrizeName: "C1",
        subPrizeRemainingQuantity: 2,
      },
      {
        subPrizeID: 4,
        prizeGroup: "D",
        subPrizeName: "D1",
        subPrizeRemainingQuantity: 6,
      },
      {
        subPrizeID: 5,
        prizeGroup: "E",
        subPrizeName: "E1",
        subPrizeRemainingQuantity: 14,
      },
      {
        subPrizeID: 6,
        prizeGroup: "F",
        subPrizeName: "F1",
        subPrizeRemainingQuantity: 2,
      },
      {
        subPrizeID: 7,
        prizeGroup: "F",
        subPrizeName: "F2",
        subPrizeRemainingQuantity: 2,
      },
      {
        subPrizeID: 8,
        prizeGroup: "F",
        subPrizeName: "F3",
        subPrizeRemainingQuantity: 2,
      },
      {
        subPrizeID: 9,
        prizeGroup: "F",
        subPrizeName: "F4",
        subPrizeRemainingQuantity: 2,
      },
      {
        subPrizeID: 10,
        prizeGroup: "F",
        subPrizeName: "F5",
        subPrizeRemainingQuantity: 2,
      },
      {
        subPrizeID: 11,
        prizeGroup: "F",
        subPrizeName: "F6",
        subPrizeRemainingQuantity: 2,
      },
      {
        subPrizeID: 12,
        prizeGroup: "F",
        subPrizeName: "F7",
        subPrizeRemainingQuantity: 2,
      },
      {
        subPrizeID: 13,
        prizeGroup: "F",
        subPrizeName: "F8",
        subPrizeRemainingQuantity: 2,
      },
      {
        subPrizeID: 14,
        prizeGroup: "F",
        subPrizeName: "F9",
        subPrizeRemainingQuantity: 2,
      },
      {
        subPrizeID: 15,
        prizeGroup: "F",
        subPrizeName: "F10",
        subPrizeRemainingQuantity: 2,
      },
      {
        subPrizeID: 16,
        prizeGroup: "F",
        subPrizeName: "F11",
        subPrizeRemainingQuantity: 2,
      },
      {
        subPrizeID: 17,
        prizeGroup: "F",
        subPrizeName: "F12",
        subPrizeRemainingQuantity: 2,
      },
      {
        subPrizeID: 18,
        prizeGroup: "G",
        subPrizeName: "G1",
        subPrizeRemainingQuantity: 30,
      },
    ],
  },
  {
    seriesName: "YU-GI-OH! SERIES VOL.3",
    price: ethers.parseEther("9"), // Example price in Ether
    priceInTWD: 270,
    estimateDeliverTime: Math.floor(Date.now() / 1000),
    totalPrizeQuantity: 80,
    exchangeTokenURI:
      "https://lime-basic-thrush-351.mypinata.cloud/ipfs/QmcPrzGkq1DKDDrQ1NpXxYJBhRDGrpp4H1hdfz62mJm3yG/",
    unrevealTokenURI:
      "https://lime-basic-thrush-351.mypinata.cloud/ipfs/QmYqPLb3bUowPsMa3hXz5mosBW6N1zmut2PNuh5GuQWfQj/1",
    revealTokenURI:
      "https://lime-basic-thrush-351.mypinata.cloud/ipfs/QmSV7FFzoY9iNCeu874HxVKCCgZ9yXraE7LSqDhdKUbRUp/",
    seriesMetaDataURI:
      "https://lime-basic-thrush-351.mypinata.cloud/ipfs/QmcEFXZ4YjbffkhNPwywXJ621CUu5KD18o7Q8oS7xQb82y",
    prizes: [
      {
        subPrizeID: 1,
        prizeGroup: "A",
        subPrizeName: "A1",
        subPrizeRemainingQuantity: 2,
      },
      {
        subPrizeID: 2,
        prizeGroup: "B",
        subPrizeName: "B1",
        subPrizeRemainingQuantity: 2,
      },
      {
        subPrizeID: 3,
        prizeGroup: "C",
        subPrizeName: "C1",
        subPrizeRemainingQuantity: 2,
      },
      {
        subPrizeID: 4,
        prizeGroup: "D",
        subPrizeName: "D1",
        subPrizeRemainingQuantity: 6,
      },
      {
        subPrizeID: 5,
        prizeGroup: "E",
        subPrizeName: "E1",
        subPrizeRemainingQuantity: 14,
      },
      {
        subPrizeID: 6,
        prizeGroup: "F",
        subPrizeName: "F1",
        subPrizeRemainingQuantity: 2,
      },
      {
        subPrizeID: 7,
        prizeGroup: "F",
        subPrizeName: "F2",
        subPrizeRemainingQuantity: 2,
      },
      {
        subPrizeID: 8,
        prizeGroup: "F",
        subPrizeName: "F3",
        subPrizeRemainingQuantity: 2,
      },
      {
        subPrizeID: 9,
        prizeGroup: "F",
        subPrizeName: "F4",
        subPrizeRemainingQuantity: 2,
      },
      {
        subPrizeID: 10,
        prizeGroup: "F",
        subPrizeName: "F5",
        subPrizeRemainingQuantity: 2,
      },
      {
        subPrizeID: 11,
        prizeGroup: "F",
        subPrizeName: "F6",
        subPrizeRemainingQuantity: 2,
      },
      {
        subPrizeID: 12,
        prizeGroup: "F",
        subPrizeName: "F7",
        subPrizeRemainingQuantity: 2,
      },
      {
        subPrizeID: 13,
        prizeGroup: "F",
        subPrizeName: "F8",
        subPrizeRemainingQuantity: 2,
      },
      {
        subPrizeID: 14,
        prizeGroup: "F",
        subPrizeName: "F9",
        subPrizeRemainingQuantity: 2,
      },
      {
        subPrizeID: 15,
        prizeGroup: "F",
        subPrizeName: "F10",
        subPrizeRemainingQuantity: 2,
      },
      {
        subPrizeID: 16,
        prizeGroup: "F",
        subPrizeName: "F11",
        subPrizeRemainingQuantity: 2,
      },
      {
        subPrizeID: 17,
        prizeGroup: "F",
        subPrizeName: "F12",
        subPrizeRemainingQuantity: 2,
      },
      {
        subPrizeID: 18,
        prizeGroup: "G",
        subPrizeName: "G1",
        subPrizeRemainingQuantity: 30,
      },
    ],
  },
  {
    seriesName: "Comic Nova14 - tinaaaaalee.cosplay",
    price: ethers.parseEther("12.5"), // Example price in Ether
    priceInTWD: 400,
    estimateDeliverTime: 1716480321,
    totalPrizeQuantity: 346,
    exchangeTokenURI:
      "https://lime-basic-thrush-351.mypinata.cloud/ipfs/Qme5zEcxXy22uDopvo8HCmUkM4yYoDcXY1wjgStRbcWiVQ/",
    unrevealTokenURI:
      "https://lime-basic-thrush-351.mypinata.cloud/ipfs/QmSRGc9Wz28NK3dCjUkM7sSuX1e36y3qiqW2hyQxQyKJBa",
    revealTokenURI:
      "https://lime-basic-thrush-351.mypinata.cloud/ipfs/QmR6cnyxQ9mfS4Mgxhsb15MVxXC6f25TaQ1wGwDbbU5t9g/",
    seriesMetaDataURI:
      "https://lime-basic-thrush-351.mypinata.cloud/ipfs/QmPEQVf9RtvuJcr925M7rJucfwu4HSJ2h94wvMWM7VkixK",
    prizes: [
      {
        subPrizeID: 1,
        prizeGroup: "A",
        subPrizeName: "A1",
        subPrizeRemainingQuantity: 4,
      },
      {
        subPrizeID: 2,
        prizeGroup: "B",
        subPrizeName: "B1",
        subPrizeRemainingQuantity: 43,
      },
      {
        subPrizeID: 3,
        prizeGroup: "C",
        subPrizeName: "C1",
        subPrizeRemainingQuantity: 88,
      },
      {
        subPrizeID: 4,
        prizeGroup: "D",
        subPrizeName: "D1",
        subPrizeRemainingQuantity: 26,
      },
      {
        subPrizeID: 5,
        prizeGroup: "E",
        subPrizeName: "E1",
        subPrizeRemainingQuantity: 84,
      },
      {
        subPrizeID: 6,
        prizeGroup: "F",
        subPrizeName: "F1",
        subPrizeRemainingQuantity: 43,
      },
      {
        subPrizeID: 7,
        prizeGroup: "G",
        subPrizeName: "G1",
        subPrizeRemainingQuantity: 58,
      },
    ],
  },

  // Repeat for other series...
  // {
  //   seriesName: "JOJO",
  //   price: ethers.parseEther("0"), // Example price in Ether
  //   estimateDeliverTime: Math.floor(Date.now() / 1000),
  //   exchangeTokenURI:
  //     "https://lime-basic-thrush-351.mypinata.cloud/ipfs/QmZH2bCxyHHheyucyoQrCuT2jgAqcKqrDMHdLPbEb13ur5/",
  //   unrevealTokenURI:
  //     "https://lime-basic-thrush-351.mypinata.cloud/ipfs/QmSWb9qNc46gQWQop5N27jF68Tdmd4VH1F1rCT3czxxUzQ/0",
  //   revealTokenURI:
  //     "https://lime-basic-thrush-351.mypinata.cloud/ipfs/QmT6gkLAfPeFWfghVgPEYgMcmYqFHA6Ypy9P46pu1H4ARe/",
  //   seriesMetaDataURI:
  //     "https://lime-basic-thrush-351.mypinata.cloud/ipfs/QmRJEuZA55okBADVeoK2Fd6Uy5CRHEBNn2DumXKpZnxN9A/series1.json",
  //   prizes: [
  //     // Assuming Prize is a struct with fields like name and remainingQuantity
  //     // modify to match your contract's subPrize struct
  //     { subPrizeID: 1, prizeGroup: "A", subPrizeName: "A1", subPrizeRemainingQuantity: 2 },
  //     { subPrizeID: 2, prizeGroup: "B", subPrizeName: "B1", subPrizeRemainingQuantity: 2 },
  //     { subPrizeID: 3, prizeGroup: "C", subPrizeName: "C1", subPrizeRemainingQuantity: 3 },
  //     { subPrizeID: 4, prizeGroup: "D", subPrizeName: "D1", subPrizeRemainingQuantity: 3 },
  //     { subPrizeID: 5, prizeGroup: "E", subPrizeName: "E1", subPrizeRemainingQuantity: 15 },
  //     { subPrizeID: 6, prizeGroup: "F", subPrizeName: "F1", subPrizeRemainingQuantity: 10 },
  //     { subPrizeID: 7, prizeGroup: "F", subPrizeName: "F2", subPrizeRemainingQuantity: 10 },
  //     { subPrizeID: 8, prizeGroup: "G", subPrizeName: "G1", subPrizeRemainingQuantity: 15 },
  //     { subPrizeID: 9, prizeGroup: "G", subPrizeName: "G2", subPrizeRemainingQuantity: 10 }
  //   ],
  // }
  // Help me to repeat this two series for 15 series, one is HunterxHunter and the other is JOJO
  // {
  //   seriesName: "HunterxHunter",
  //   price: ethers.parseEther("0.0001"), // Example price in Ether
  //   estimateDeliverTime: Math.floor(Date.now() / 1000) + secondsInADay * 5,
  //   exchangeTokenURI:
  //     "https://lime-basic-thrush-351.mypinata.cloud/ipfs/QmSsdZVZrDbTWc8W2C3rEJ2DRH3yWRpJP9UUEr77tw4mFo/",
  //   unrevealTokenURI:
  //     "https://lime-basic-thrush-351.mypinata.cloud/ipfs/QmSWb9qNc46gQWQop5N27jF68Tdmd4VH1F1rCT3czxxUzQ/0",
  //   revealTokenURI:
  //     "https://lime-basic-thrush-351.mypinata.cloud/ipfs/QmRkTPoSoWAzJMfqqNHtpJ1Lr6HLcuMCE2V4JsRuvtaLpj/",
  //   seriesMetaDataURI:
  //     "https://lime-basic-thrush-351.mypinata.cloud/ipfs/QmYxweAJixyVVAeQeGf6y8CVk4GmUBTfNiVJvusgcaUuMU/series2.json",
  //   prizes: [
  //     // Assuming Prize is a struct with fields like name and remainingQuantity
  //     { name: "A", remainingQuantity: 2 },
  //     { name: "B", remainingQuantity: 2 },
  //     { name: "C", remainingQuantity: 3 },
  //     { name: "D", remainingQuantity: 3 },
  //     { name: "E", remainingQuantity: 15 },
  //     { name: "F", remainingQuantity: 20 },
  //     { name: "G", remainingQuantity: 25 },
  //   ],
  // },
  // {
  //   seriesName: "JOJO",
  //   price: ethers.parseEther("10"), // Example price in Ether
  //   estimateDeliverTime: Math.floor(Date.now() / 1000) + secondsInADay * 7,
  //   exchangeTokenURI:
  //     "https://lime-basic-thrush-351.mypinata.cloud/ipfs/QmaoRXEHHeNUW57rTP17MuNf56qrEVRtEFtopKK598KEqt/",
  //   unrevealTokenURI:
  //     "https://lime-basic-thrush-351.mypinata.cloud/ipfs/QmSWb9qNc46gQWQop5N27jF68Tdmd4VH1F1rCT3czxxUzQ/0",
  //   revealTokenURI:
  //     "https://lime-basic-thrush-351.mypinata.cloud/ipfs/QmPuJZzKS5aVc267sSVACeqBChmuPCNV6CgzFrZniENB7Z/",
  //   seriesMetaDataURI:
  //     "https://lime-basic-thrush-351.mypinata.cloud/ipfs/QmYxweAJixyVVAeQeGf6y8CVk4GmUBTfNiVJvusgcaUuMU/series3.json",
  //   prizes: [
  //     // Assuming Prize is a struct with fields like name and remainingQuantity
  //     { name: "A", remainingQuantity: 2 },
  //     { name: "B", remainingQuantity: 2 },
  //     { name: "C", remainingQuantity: 3 },
  //     { name: "D", remainingQuantity: 3 },
  //     { name: "E", remainingQuantity: 15 },
  //     { name: "F", remainingQuantity: 20 },
  //     { name: "G", remainingQuantity: 25 },
  //   ],
  // },
  // {
  //   seriesName: "HunterxHunter",
  //   price: ethers.parseEther("0"), // Example price in Ether
  //   estimateDeliverTime: Math.floor(Date.now() / 1000) + secondsInADay * 9,
  //   exchangeTokenURI:
  //     "https://lime-basic-thrush-351.mypinata.cloud/ipfs/QmSsdZVZrDbTWc8W2C3rEJ2DRH3yWRpJP9UUEr77tw4mFo/",
  //   unrevealTokenURI:
  //     "https://lime-basic-thrush-351.mypinata.cloud/ipfs/QmSWb9qNc46gQWQop5N27jF68Tdmd4VH1F1rCT3czxxUzQ/0",
  //   revealTokenURI:
  //     "https://lime-basic-thrush-351.mypinata.cloud/ipfs/QmRkTPoSoWAzJMfqqNHtpJ1Lr6HLcuMCE2V4JsRuvtaLpj/",
  //   seriesMetaDataURI:
  //     "https://lime-basic-thrush-351.mypinata.cloud/ipfs/QmYxweAJixyVVAeQeGf6y8CVk4GmUBTfNiVJvusgcaUuMU/series4.json",
  //   prizes: [
  //     // Assuming Prize is a struct with fields like name and remainingQuantity
  //     { name: "A", remainingQuantity: 2 },
  //     { name: "B", remainingQuantity: 2 },
  //     { name: "C", remainingQuantity: 3 },
  //     { name: "D", remainingQuantity: 3 },
  //     { name: "E", remainingQuantity: 15 },
  //     { name: "F", remainingQuantity: 20 },
  //     { name: "G", remainingQuantity: 25 },
  //   ],
  // },
  // // Repeat for other series...
  // {
  //   seriesName: "JOJO",
  //   price: ethers.parseEther("9.9"), // Example price in Ether
  //   estimateDeliverTime: Math.floor(Date.now() / 1000) + secondsInADay * 15,
  //   exchangeTokenURI:
  //     "https://lime-basic-thrush-351.mypinata.cloud/ipfs/QmaoRXEHHeNUW57rTP17MuNf56qrEVRtEFtopKK598KEqt/",
  //   unrevealTokenURI:
  //     "https://lime-basic-thrush-351.mypinata.cloud/ipfs/QmSWb9qNc46gQWQop5N27jF68Tdmd4VH1F1rCT3czxxUzQ/0",
  //   revealTokenURI:
  //     "https://lime-basic-thrush-351.mypinata.cloud/ipfs/QmPuJZzKS5aVc267sSVACeqBChmuPCNV6CgzFrZniENB7Z/",
  //   seriesMetaDataURI:
  //     "https://lime-basic-thrush-351.mypinata.cloud/ipfs/QmYxweAJixyVVAeQeGf6y8CVk4GmUBTfNiVJvusgcaUuMU/series5.json",
  //   prizes: [
  //     // Assuming Prize is a struct with fields like name and remainingQuantity
  //     { name: "A", remainingQuantity: 2 },
  //     { name: "B", remainingQuantity: 2 },
  //     { name: "C", remainingQuantity: 3 },
  //     { name: "D", remainingQuantity: 3 },
  //     { name: "E", remainingQuantity: 15 },
  //     { name: "F", remainingQuantity: 20 },
  //     { name: "G", remainingQuantity: 25 },
  //   ],
  // },
  // {
  //   seriesName: "HunterxHunter",
  //   price: ethers.parseEther("0"), // Example price in Ether
  //   estimateDeliverTime: Math.floor(Date.now() / 1000) + secondsInADay * 20,
  //   exchangeTokenURI:
  //     "https://lime-basic-thrush-351.mypinata.cloud/ipfs/QmSsdZVZrDbTWc8W2C3rEJ2DRH3yWRpJP9UUEr77tw4mFo/",
  //   unrevealTokenURI:
  //     "https://lime-basic-thrush-351.mypinata.cloud/ipfs/QmSWb9qNc46gQWQop5N27jF68Tdmd4VH1F1rCT3czxxUzQ/0",
  //   revealTokenURI:
  //     "https://lime-basic-thrush-351.mypinata.cloud/ipfs/QmRkTPoSoWAzJMfqqNHtpJ1Lr6HLcuMCE2V4JsRuvtaLpj/",
  //   seriesMetaDataURI:
  //     "https://lime-basic-thrush-351.mypinata.cloud/ipfs/QmYxweAJixyVVAeQeGf6y8CVk4GmUBTfNiVJvusgcaUuMU/series6.json",
  //   prizes: [
  //     // Assuming Prize is a struct with fields like name and remainingQuantity
  //     { name: "A", remainingQuantity: 2 },
  //     { name: "B", remainingQuantity: 2 },
  //     { name: "C", remainingQuantity: 3 },
  //     { name: "D", remainingQuantity: 3 },
  //     { name: "E", remainingQuantity: 15 },
  //     { name: "F", remainingQuantity: 20 },
  //     { name: "G", remainingQuantity: 25 },
  //   ],
  // },
  // // Repeat for other series...
  // {
  //   seriesName: "JOJO",
  //   price: ethers.parseEther("8.99"), // Example price in Ether
  //   estimateDeliverTime: Math.floor(Date.now() / 1000) + secondsInADay * 30, // Current time
  //   exchangeTokenURI:
  //     "https://lime-basic-thrush-351.mypinata.cloud/ipfs/QmaoRXEHHeNUW57rTP17MuNf56qrEVRtEFtopKK598KEqt/",
  //   unrevealTokenURI:
  //     "https://lime-basic-thrush-351.mypinata.cloud/ipfs/QmSWb9qNc46gQWQop5N27jF68Tdmd4VH1F1rCT3czxxUzQ/0",
  //   revealTokenURI:
  //     "https://lime-basic-thrush-351.mypinata.cloud/ipfs/QmPuJZzKS5aVc267sSVACeqBChmuPCNV6CgzFrZniENB7Z/",
  //   seriesMetaDataURI:
  //     "https://lime-basic-thrush-351.mypinata.cloud/ipfs/QmYxweAJixyVVAeQeGf6y8CVk4GmUBTfNiVJvusgcaUuMU/series7.json",
  //   prizes: [
  //     // Assuming Prize is a struct with fields like name and remainingQuantity
  //     { name: "A", remainingQuantity: 2 },
  //     { name: "B", remainingQuantity: 2 },
  //     { name: "C", remainingQuantity: 3 },
  //     { name: "D", remainingQuantity: 3 },
  //     { name: "E", remainingQuantity: 15 },
  //     { name: "F", remainingQuantity: 20 },
  //     { name: "G", remainingQuantity: 25 },
  //   ],
  // },
  // {
  //   seriesName: "HunterxHunter",
  //   price: ethers.parseEther("0"), // Example price in Ether
  //   estimateDeliverTime: Math.floor(Date.now() / 1000) + secondsInADay * 60, // Current time
  //   exchangeTokenURI:
  //     "https://lime-basic-thrush-351.mypinata.cloud/ipfs/QmSsdZVZrDbTWc8W2C3rEJ2DRH3yWRpJP9UUEr77tw4mFo/",
  //   unrevealTokenURI:
  //     "https://lime-basic-thrush-351.mypinata.cloud/ipfs/QmSWb9qNc46gQWQop5N27jF68Tdmd4VH1F1rCT3czxxUzQ/0",
  //   revealTokenURI:
  //     "https://lime-basic-thrush-351.mypinata.cloud/ipfs/QmRkTPoSoWAzJMfqqNHtpJ1Lr6HLcuMCE2V4JsRuvtaLpj/",
  //   seriesMetaDataURI:
  //     "https://lime-basic-thrush-351.mypinata.cloud/ipfs/QmYxweAJixyVVAeQeGf6y8CVk4GmUBTfNiVJvusgcaUuMU/series8.json",
  //   prizes: [
  //     // Assuming Prize is a struct with fields like name and remainingQuantity
  //     { name: "A", remainingQuantity: 2 },
  //     { name: "B", remainingQuantity: 2 },
  //     { name: "C", remainingQuantity: 3 },
  //     { name: "D", remainingQuantity: 3 },
  //     { name: "E", remainingQuantity: 15 },
  //     { name: "F", remainingQuantity: 20 },
  //     { name: "G", remainingQuantity: 25 },
  //   ],
  // },
  // // Repeat for other series...
  // {
  //   seriesName: "JOJO",
  //   price: ethers.parseEther("0"), // Example price in Ether
  //   estimateDeliverTime: Math.floor(Date.now() / 1000) + secondsInADay * 90, // Current time
  //   exchangeTokenURI:
  //     "https://lime-basic-thrush-351.mypinata.cloud/ipfs/QmaoRXEHHeNUW57rTP17MuNf56qrEVRtEFtopKK598KEqt/",
  //   unrevealTokenURI:
  //     "https://lime-basic-thrush-351.mypinata.cloud/ipfs/QmSWb9qNc46gQWQop5N27jF68Tdmd4VH1F1rCT3czxxUzQ/0",
  //   revealTokenURI:
  //     "https://lime-basic-thrush-351.mypinata.cloud/ipfs/QmPuJZzKS5aVc267sSVACeqBChmuPCNV6CgzFrZniENB7Z/",
  //   seriesMetaDataURI:
  //     "https://lime-basic-thrush-351.mypinata.cloud/ipfs/QmYxweAJixyVVAeQeGf6y8CVk4GmUBTfNiVJvusgcaUuMU/series9.json",
  //   prizes: [
  //     // Assuming Prize is a struct with fields like name and remainingQuantity
  //     { name: "A", remainingQuantity: 2 },
  //     { name: "B", remainingQuantity: 2 },
  //     { name: "C", remainingQuantity: 3 },
  //     { name: "D", remainingQuantity: 3 },
  //     { name: "E", remainingQuantity: 15 },
  //     { name: "F", remainingQuantity: 20 },
  //     { name: "G", remainingQuantity: 25 },
  //   ],
  // },
  // {
  //   seriesName: "HunterxHunter",
  //   price: ethers.parseEther("0"), // Example price in Ether
  //   estimateDeliverTime: Math.floor(Date.now() / 1000) + secondsInADay * 360, // Current time
  //   exchangeTokenURI:
  //     "https://lime-basic-thrush-351.mypinata.cloud/ipfs/QmSsdZVZrDbTWc8W2C3rEJ2DRH3yWRpJP9UUEr77tw4mFo/",
  //   unrevealTokenURI:
  //     "https://lime-basic-thrush-351.mypinata.cloud/ipfs/QmSWb9qNc46gQWQop5N27jF68Tdmd4VH1F1rCT3czxxUzQ/0",
  //   revealTokenURI:
  //     "https://lime-basic-thrush-351.mypinata.cloud/ipfs/QmRkTPoSoWAzJMfqqNHtpJ1Lr6HLcuMCE2V4JsRuvtaLpj/",
  //   seriesMetaDataURI:
  //     "https://lime-basic-thrush-351.mypinata.cloud/ipfs/QmYxweAJixyVVAeQeGf6y8CVk4GmUBTfNiVJvusgcaUuMU/series10.json",
  //   prizes: [
  //     // Assuming Prize is a struct with fields like name and remainingQuantity
  //     { name: "A", remainingQuantity: 2 },
  //     { name: "B", remainingQuantity: 2 },
  //     { name: "C", remainingQuantity: 3 },
  //     { name: "D", remainingQuantity: 3 },
  //     { name: "E", remainingQuantity: 15 },
  //     { name: "F", remainingQuantity: 20 },
  //     { name: "G", remainingQuantity: 25 },
  //   ],
  // },
  // // Repeat for other series...
  // {
  //   seriesName: "JOJO",
  //   price: ethers.parseEther("0"), // Example price in Ether
  //   estimateDeliverTime: Math.floor(Date.now() / 1000) + secondsInADay * 720, // Current time
  //   exchangeTokenURI:
  //     "https://lime-basic-thrush-351.mypinata.cloud/ipfs/QmaoRXEHHeNUW57rTP17MuNf56qrEVRtEFtopKK598KEqt/",
  //   unrevealTokenURI:
  //     "https://lime-basic-thrush-351.mypinata.cloud/ipfs/QmSWb9qNc46gQWQop5N27jF68Tdmd4VH1F1rCT3czxxUzQ/0",
  //   revealTokenURI:
  //     "https://lime-basic-thrush-351.mypinata.cloud/ipfs/QmPuJZzKS5aVc267sSVACeqBChmuPCNV6CgzFrZniENB7Z/",
  //   seriesMetaDataURI:
  //     "https://lime-basic-thrush-351.mypinata.cloud/ipfs/QmYxweAJixyVVAeQeGf6y8CVk4GmUBTfNiVJvusgcaUuMU/series11.json",
  //   prizes: [
  //     // Assuming Prize is a struct with fields like name and remainingQuantity
  //     { name: "A", remainingQuantity: 2 },
  //     { name: "B", remainingQuantity: 2 },
  //     { name: "C", remainingQuantity: 3 },
  //     { name: "D", remainingQuantity: 3 },
  //     { name: "E", remainingQuantity: 15 },
  //     { name: "F", remainingQuantity: 20 },
  //     { name: "G", remainingQuantity: 25 },
  //   ],
  // },
  // {
  //   seriesName: "HunterxHunter",
  //   price: ethers.parseEther("0"), // Example price in Ether
  //   estimateDeliverTime: Math.floor(Date.now() / 1000) + secondsInADay * 1, // Current time
  //   exchangeTokenURI:
  //     "https://lime-basic-thrush-351.mypinata.cloud/ipfs/QmSsdZVZrDbTWc8W2C3rEJ2DRH3yWRpJP9UUEr77tw4mFo/",
  //   unrevealTokenURI:
  //     "https://lime-basic-thrush-351.mypinata.cloud/ipfs/QmSWb9qNc46gQWQop5N27jF68Tdmd4VH1F1rCT3czxxUzQ/0",
  //   revealTokenURI:
  //     "https://lime-basic-thrush-351.mypinata.cloud/ipfs/QmRkTPoSoWAzJMfqqNHtpJ1Lr6HLcuMCE2V4JsRuvtaLpj/",
  //   seriesMetaDataURI:
  //     "https://lime-basic-thrush-351.mypinata.cloud/ipfs/QmYxweAJixyVVAeQeGf6y8CVk4GmUBTfNiVJvusgcaUuMU/series12.json",
  //   prizes: [
  //     // Assuming Prize is a struct with fields like name and remainingQuantity
  //     { name: "A", remainingQuantity: 2 },
  //     { name: "B", remainingQuantity: 2 },
  //     { name: "C", remainingQuantity: 3 },
  //     { name: "D", remainingQuantity: 3 },
  //     { name: "E", remainingQuantity: 15 },
  //     { name: "F", remainingQuantity: 20 },
  //     { name: "G", remainingQuantity: 25 },
  //   ],
  // },
  // // Repeat for other series...
  // {
  //   seriesName: "JOJO",
  //   price: ethers.parseEther("0"), // Example price in Ether
  //   estimateDeliverTime: Math.floor(Date.now() / 1000) + secondsInADay * 3, // Current time
  //   exchangeTokenURI:
  //     "https://lime-basic-thrush-351.mypinata.cloud/ipfs/QmaoRXEHHeNUW57rTP17MuNf56qrEVRtEFtopKK598KEqt/",
  //   unrevealTokenURI:
  //     "https://lime-basic-thrush-351.mypinata.cloud/ipfs/QmSWb9qNc46gQWQop5N27jF68Tdmd4VH1F1rCT3czxxUzQ/0",
  //   revealTokenURI:
  //     "https://lime-basic-thrush-351.mypinata.cloud/ipfs/QmPuJZzKS5aVc267sSVACeqBChmuPCNV6CgzFrZniENB7Z/",
  //   seriesMetaDataURI:
  //     "https://lime-basic-thrush-351.mypinata.cloud/ipfs/QmYxweAJixyVVAeQeGf6y8CVk4GmUBTfNiVJvusgcaUuMU/series13.json",
  //   prizes: [
  //     // Assuming Prize is a struct with fields like name and remainingQuantity
  //     { name: "A", remainingQuantity: 2 },
  //     { name: "B", remainingQuantity: 2 },
  //     { name: "C", remainingQuantity: 3 },
  //     { name: "D", remainingQuantity: 3 },
  //     { name: "E", remainingQuantity: 15 },
  //     { name: "F", remainingQuantity: 20 },
  //     { name: "G", remainingQuantity: 25 },
  //   ],
  // },
  // {
  //   seriesName: "HunterxHunter",
  //   price: ethers.parseEther("0"), // Example price in Ether
  //   estimateDeliverTime: Math.floor(Date.now() / 1000), // Current time
  //   exchangeTokenURI:
  //     "https://lime-basic-thrush-351.mypinata.cloud/ipfs/QmSsdZVZrDbTWc8W2C3rEJ2DRH3yWRpJP9UUEr77tw4mFo/",
  //   unrevealTokenURI:
  //     "https://lime-basic-thrush-351.mypinata.cloud/ipfs/QmSWb9qNc46gQWQop5N27jF68Tdmd4VH1F1rCT3czxxUzQ/0",
  //   revealTokenURI:
  //     "https://lime-basic-thrush-351.mypinata.cloud/ipfs/QmRkTPoSoWAzJMfqqNHtpJ1Lr6HLcuMCE2V4JsRuvtaLpj/",
  //   seriesMetaDataURI:
  //     "https://lime-basic-thrush-351.mypinata.cloud/ipfs/QmYxweAJixyVVAeQeGf6y8CVk4GmUBTfNiVJvusgcaUuMU/series14.json",
  //   prizes: [
  //     // Assuming Prize is a struct with fields like name and remainingQuantity
  //     { name: "A", remainingQuantity: 2 },
  //     { name: "B", remainingQuantity: 2 },
  //     { name: "C", remainingQuantity: 3 },
  //     { name: "D", remainingQuantity: 3 },
  //     { name: "E", remainingQuantity: 15 },
  //     { name: "F", remainingQuantity: 20 },
  //     { name: "G", remainingQuantity: 25 },
  //   ],
  // },
  // // Repeat for other series...
  // {
  //   seriesName: "JOJO",
  //   price: ethers.parseEther("0"), // Example price in Ether
  //   estimateDeliverTime: Math.floor(Date.now() / 1000), // Current time
  //   exchangeTokenURI:
  //     "https://lime-basic-thrush-351.mypinata.cloud/ipfs/QmaoRXEHHeNUW57rTP17MuNf56qrEVRtEFtopKK598KEqt/",
  //   unrevealTokenURI:
  //     "https://lime-basic-thrush-351.mypinata.cloud/ipfs/QmSWb9qNc46gQWQop5N27jF68Tdmd4VH1F1rCT3czxxUzQ/0",
  //   revealTokenURI:
  //     "https://lime-basic-thrush-351.mypinata.cloud/ipfs/QmPuJZzKS5aVc267sSVACeqBChmuPCNV6CgzFrZniENB7Z/",
  //   seriesMetaDataURI:
  //     "https://lime-basic-thrush-351.mypinata.cloud/ipfs/QmYxweAJixyVVAeQeGf6y8CVk4GmUBTfNiVJvusgcaUuMU/series15.json",
  //   prizes: [
  //     // Assuming Prize is a struct with fields like name and remainingQuantity
  //     { name: "A", remainingQuantity: 2 },
  //     { name: "B", remainingQuantity: 2 },
  //     { name: "C", remainingQuantity: 3 },
  //     { name: "D", remainingQuantity: 3 },
  //     { name: "E", remainingQuantity: 15 },
  //     { name: "F", remainingQuantity: 20 },
  //     { name: "G", remainingQuantity: 25 },
  //   ],
  // },
  // // Repeat for other series...
  // {
  //   seriesName: "OnePiece",
  //   price: ethers.parseEther("0"), // Example price in Ether
  //   estimateDeliverTime: Math.floor(Date.now() / 1000),
  //   exchangeTokenURI:
  //     "https://lime-basic-thrush-351.mypinata.cloud/ipfs/QmPqtCHibhKDW99ufp4S8a4SvMrhUfRPA1B2BmC3ggBkB5/",
  //   unrevealTokenURI:
  //     "https://lime-basic-thrush-351.mypinata.cloud/ipfs/QmWyTfiFny338YSVuZFkcsgmimwUo5DMSbdRbxTKVgLWhe",
  //   revealTokenURI:
  //     "https://lime-basic-thrush-351.mypinata.cloud/ipfs/QmQsLz5UF78wgfqEBB2ydQor8hruci2CDcS8DfAoRVpCwt/",
  //   seriesMetaDataURI:
  //     "https://lime-basic-thrush-351.mypinata.cloud/ipfs/QmbDVkaAxdVSvykhCzfwgBQd4bGWrQxtHQgbya9AGaCqpH",
  //   prizes: [
  //     // Assuming Prize is a struct with fields like name and remainingQuantity
  //     { name: "A", remainingQuantity: 2 },
  //     { name: "B", remainingQuantity: 2 },
  //     { name: "C", remainingQuantity: 3 },
  //     { name: "D", remainingQuantity: 3 },
  //     { name: "E", remainingQuantity: 15 },
  //     { name: "F", remainingQuantity: 20 },
  //     { name: "G", remainingQuantity: 25 },
  //   ],
  // },
];

async function main() {
  // Deploy the contract
  const ICHICHAINFactory = await ethers.getContractFactory("ICHICHAIN");
  const ICHICHAINContract = await ICHICHAINFactory.deploy(
    process.env.BNB_LINK_SUBSCRIPTIONS || "",
    process.env.BNB_LINK_TOKEN || ""
  );
  console.log("Deploying ICHICHAIN contract...");
  await ICHICHAINContract.waitForDeployment();

  console.log("Contract deployed to:", ICHICHAINContract.target);

  // Create each series
  for (const [index, series] of seriesData.entries()) {
    // Convert Prize[] structure to match your contract's expectations
    const prizes = series.prizes.map((prize) => {
      // Adapt this part based on your contract's Prize struct
      return {
        subPrizeID: prize.subPrizeID,
        prizeGroup: prize.prizeGroup,
        subPrizeName: prize.subPrizeName,
        subPrizeRemainingQuantity: prize.subPrizeRemainingQuantity,
      };
    });

    await ICHICHAINContract.createSeries(
      series.seriesName,
      series.price,
      series.priceInTWD,
      series.estimateDeliverTime,
      series.totalPrizeQuantity,
      series.exchangeTokenURI,
      series.unrevealTokenURI,
      series.revealTokenURI,
      series.seriesMetaDataURI
    );
    // sleep for 2 mins
    await new Promise((resolve) => setTimeout(resolve, 120000));
    // Update the series prizes by for each length of the prizes
    await ICHICHAINContract.updateSeriesSubPrize(index, prizes);
  }
  await ICHICHAINContract.addCurrencyToken(
    "0x69a68F1a7C3A502cf9A290519b2088B1848BF259",
    "0x69a68F1a7C3A502cf9A290519b2088B1848BF259",
    ethers.parseEther("1")
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
