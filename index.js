"strict mode";
const request = require("request-promise-native");
const parser = require("fast-xml-parser");
const errorCodes = require("./errorCodes");

class PagSeguro {
  constructor({ email, token, sandbox, sandboxEmail }) {
    this.email = email;
    this.token = token;
    this.sandbox = !!sandbox;
    this.sandboxEmail = sandboxEmail;

    this.currency = "BRL";
    this.url = this.sandbox
      ? "https://ws.sandbox.pagseguro.uol.com.br/v2"
      : "https://ws.pagseguro.uol.com.br/v2";

    this.checkoutData = {
      email: this.email,
      token: this.token,
      sandbox: this.sandbox,
      currency: this.currency,
      url: this.url
    };

    this.setPaymentMethod = {
      creditCard: (
        { card },
        {
          creditCardHolderName,
          creditCardHolderCPF,
          creditCardHolderBirthDate,
          creditCardHolderAreaCode,
          creditCardHolderPhone
        },
        {
          sameAsShipping,
          billingAddressStreet,
          billingAddressNumber,
          billingAddressComplement,
          billingAddressDistrict,
          billingAddressPostalCode,
          billingAddressCity,
          billingAddressState
        },
        { installmentQuantity, installmentValue, noInterestInstallmentQuantity }
      ) => {
        this.cardHolder = {
          creditCardHolderName,
          creditCardHolderCPF,
          creditCardHolderBirthDate,
          creditCardHolderAreaCode,
          creditCardHolderPhone
        };

        this.billing = {};

        if (sameAsShipping) {
          Object.keys(this.shippingAddress).forEach(key => {
            if (!["shippingCost", "shippingType"].includes(key)) {
              const value = this.shippingAddress[key];
              const prop = key.replace("shipping", "billing");
              this.billing[prop] = value;
            }
          });
        } else {
          this.billing = {
            billingAddressStreet,
            billingAddressNumber,
            billingAddressComplement,
            billingAddressDistrict,
            billingAddressPostalCode,
            billingAddressCity,
            billingAddressState,
            billingAddressCountry: "BRA"
          };
        }

        this.installments = {
          installmentQuantity,
          installmentValue: installmentValue.toFixed(2),
          noInterestInstallmentQuantity
        };

        this.clean(this.cardHolder);
        this.clean(this.billing);
        this.clean(this.installments);

        this.paymentMethod = {
          paymentMode: "default",
          paymentMethod: "creditCard",
          creditCardToken: card.token,
          ...this.cardHolder,
          ...this.billing,
          ...this.installments
        };

        this.checkoutData = {
          ...this.checkoutData,
          ...this.paymentMethod,
          ...this.cardHolder,
          ...this.billing
        };

        return this.paymentMethod;
      }
    };

    this.items = [];
  }

  clean(obj) {
    return Object.keys(obj).forEach(
      key => obj[key] === undefined && delete obj[key]
    );
  }

  async getSession() {
    try {
      const response = await request
        .post({
          url: `${this.url}/sessions`,
          qs: {
            email: this.email,
            token: this.token
          }
        })
        .then(response => {
          return parser.parse(response);
        })
        .catch(error => {
          console.dir(error);
        });
      return { status: true, response };
    } catch (response) {
      console.dir(response);
      const error = parser.parse(response.error);
      const { code, message } = error.errors.error;
      return {
        status: false,
        message: errorCodes[code],
        error: { code, message }
      };
    }
  }
  getSender() {
    return this.sender;
  }

  getShipping() {
    return this.shipping;
  }

  getBilling() {
    return this.billing;
  }

  getCardHolder() {
    return this.cardHolder;
  }

  getItems() {
    return this.items;
  }

  getTotal() {
    return this.items.reduce((total, { amount, quantity }) => {
      return (total += Number(amount) * quantity);
    }, 0);
  }

  getCheckoutData() {
    return this.checkoutData;
  }

  setSender({
    senderHash,
    senderName,
    senderAreaCode,
    senderPhone,
    senderEmail,
    senderCPF,
    senderCNPJ,
    senderIp
  }) {
    this.sender = {
      senderHash,
      senderName,
      senderAreaCode,
      senderPhone,
      senderEmail: this.sandbox ? this.sandboxEmail : senderEmail,
      senderCPF,
      senderCNPJ,
      senderIp
    };

    this.clean(this.sender);

    this.checkoutData = {
      ...this.checkoutData,
      ...this.sender
    };
    return this.checkoutData;
  }

  setShipping({
    shippingAddressRequired,
    shippingAddressStreet,
    shippingAddressNumber,
    shippingAddressDistrict,
    shippingAddressCity,
    shippingAddressState,
    shippingAddressPostalCode,
    shippingAddressComplement,
    shippingCost,
    shippingType
  }) {
    this.shippingAddress = {
      shippingAddressRequired,
      shippingAddressStreet,
      shippingAddressNumber,
      shippingAddressDistrict,
      shippingAddressCity,
      shippingAddressState,
      shippingAddressPostalCode,
      shippingAddressComplement,
      shippingCost: (shippingCost && shippingCost.toFixed(2)) || undefined,
      shippingType,
      shippingAddressCountry: "BRA"
    };

    this.clean(this.shippingAddress);

    if (!this.shippingAddressRequired) {
      this.checkoutData = {
        ...this.checkoutData,
        shippingAddressRequired
      };
    } else {
      this.checkoutData = {
        ...this.checkoutData,
        ...this.shippingAddress
      };
    }

    return this.checkoutData;
  }

  setItems(products) {
    products.forEach(({ id, description, amount, quantity }) => {
      const index = this.items.length + 1;
      const item = {};

      item[`itemId${index}`] = id;
      item[`itemDescription${index}`] = description;
      item[`itemAmount${index}`] = amount && amount.toFixed(2);
      item[`itemQuantity${index}`] = quantity;

      this.clean(item);

      this.items.push(item);
    });

    this.items.forEach(item => {
      this.checkoutData = {
        ...this.checkoutData,
        ...item
      };
    });

    return this.checkoutData;
  }

  setCheckoutData(sender, shipping, items, payment) {
    this.setSender(sender);
    this.setShipping(shipping);
    this.setItems(items);
    this.setPaymentMethod[payment.method](...payment.params);

    return this.checkoutData;
  }

  async makePayment(
    { reference, extraAmount, notificationURL },
    dryrun,
    print
  ) {
    this.checkoutData = {
      ...this.checkoutData,
      reference,
      extraAmount: extraAmount && extraAmount.toFixed(2),
      notificationURL
    };

    this.clean(this.checkoutData);

    if (dryrun || print) {
      console.table(this.checkoutData);
    }
    if (dryrun) {
      return { status: true, response: this.checkoutData };
    }

    try {
      const response = await request
        .post({
          url: `${this.url}/transactions`,
          qs: {
            email: this.email,
            token: this.token
          },
          headers: {
            "Content-Type":
              "application/x-www-form-urlencoded; charset=iso-8859-1"
          },
          form: this.checkoutData
        })
        .then(response => {
          return parser.parse(response);
        });
      return { status: true, response };
    } catch (response) {
      const error = parser.parse(response.error);
      const errors = error.errors.error;
      if (typeof errors === "object") {
        const { code, message } = errors;
        return {
          status: false,
          message: errorCodes[code],
          error: { code, message }
        };
      }
      return {
        status: false,
        messages: errors.map(({ code }) => errorCodes[code]),
        errorr: errors.map(({ code, message }) => ({ code, message }))
      };
    }
  }
}

module.exports = PagSeguro;
