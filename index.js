/**
# PDF to TXT AMQP

A single file node application that listens on the RabbitMQ exchange called "books" for json
representations of an `event` (an object with two properties:
type: string
data: object

It expects the data object to contain a PDFPath and a TXTPath property that denotes the location of a PDF file and a folder in which to store output, respectively.

It then performs OCR the input PDF into one txt file per page.

It's intended purpose is to be used in the "books" project (github.com/emilkloeden/books) as
part of the book upload and conversion pipeline

By default it expects to find RabbitMQ
at localhost:5672.
*/
const fs = require("fs");
const path = require("path");
const amqp = require("amqplib/callback_api");
const makeDir = require("make-dir");
const PDFExtract = require("pdf-extract");

const amqpURL = process.env.AMQP_URL || "amqp://localhost:5672";

function makeDirIfNotExistsSync(path) {
  const directoryExists = fs.existsSync(path);
  return directoryExists ? path : makeDir.sync(path);
}

function extractText(ch, msg, PDFPath, TXTPath, cb) {
  makeDirIfNotExistsSync(TXTPath);

  const options = { type: "ocr" };

  const processor = PDFExtract(PDFPath, options, err => {
    if (err) {
      return cb(err);
    }
  });
  ch.ack(msg); // acknowledge message on receipt, rather than completion - is this desirable?
  processor.on("page", data => {
    const { index, text } = data;

    const filePath = path.resolve(TXTPath, `${index + 1}.txt`);

    fs.writeFile(filePath, text, () => {});
  });
  processor.on("complete", data => {
    console.log("DONE!");
  });
  processor.on("error", err => {
    console.error(err);
  });
}

amqp.connect(
  amqpURL,
  (err, conn) => {
    if (err) {
      // If we error out here, we might as well quit
      console.error(`Error in connecting to RabbitMQ: ${err}`);
      process.exit(1);
    }
    conn.createChannel((err, ch) => {
      if (err) {
        console.error(`Error creating channel: ${err}`);
      }
      const ex = "books";

      ch.assertExchange(ex, "fanout", { durable: false });

      ch.assertQueue("txt", { exclusive: false }, (err, q) => {
        if (err) {
          console.error(`Error asserting queue: ${err}`);
        }
        console.log(
          ` [*] Waiting for messages in ${q.queue}. To exit press CTRL+C`
        );

        ch.bindQueue(q.queue, ex, ""); // see if third arg 'pattern' can be made use of

        ch.consume(
          q.queue,
          msg => {
            try {
              const e = JSON.parse(msg.content.toString());
              console.log(`MESSAGE: ${e.type} - ${new Date()}`);
              const { PDFPath, TXTPath } = e.data;
              extractText(ch, msg, PDFPath, TXTPath, err =>
                console.error(`Error in extractText callback: ${err}`)
              );
            } catch (err) {
              console.error(`Error in channel.consume: ${err}`);
              ch.nack(msg, false, false); // @TODO: confirm arg values
            }
          },
          { noAck: false }
        );
      });
    });
  }
);
